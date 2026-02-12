import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GroupData, GroupMessageData, GroupMemberData, CreateGroupOptions } from '@unicitylabs/sphere-sdk';
import { useServices } from '../../../contexts/useServices';
import { useSphereContext } from '../../../sdk/hooks/core/useSphere';
import { STORAGE_KEYS } from '../../../config/storageKeys';
import { getGroupDisplayName } from '../utils/groupChatHelpers';

const QUERY_KEYS = {
  GROUPS: ['groupChat', 'groups'],
  MESSAGES: (groupId: string) => ['groupChat', 'messages', groupId],
  MEMBERS: (groupId: string) => ['groupChat', 'members', groupId],
  AVAILABLE_GROUPS: ['groupChat', 'available'],
  UNREAD_COUNT: ['groupChat', 'unreadCount'],
  RELAY_ADMIN: ['groupChat', 'relayAdmin'],
};

export interface UseGroupChatReturn {
  // Groups
  groups: GroupData[];
  isLoadingGroups: boolean;
  selectedGroup: GroupData | null;
  selectGroup: (group: GroupData | null) => Promise<void>;
  joinGroup: (groupId: string, inviteCode?: string) => Promise<boolean>;
  leaveGroup: (groupId: string) => Promise<boolean>;

  // Discovery
  availableGroups: GroupData[];
  isLoadingAvailable: boolean;
  refreshAvailableGroups: () => void;

  // Messages
  messages: GroupMessageData[];
  isLoadingMessages: boolean;
  sendMessage: (content: string, replyToId?: string) => Promise<boolean>;
  isSending: boolean;

  // Members
  members: GroupMemberData[];
  isLoadingMembers: boolean;

  // Input state
  messageInput: string;
  setMessageInput: (value: string) => void;

  // Unread
  totalUnreadCount: number;
  markAsRead: (groupId: string) => void;

  // Search/Filter
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredGroups: GroupData[];

  // Connection
  isConnected: boolean;

  // Moderation
  isCurrentUserAdmin: boolean;
  isCurrentUserModerator: boolean;
  deleteMessage: (messageId: string) => Promise<boolean>;
  kickUser: (userPubkey: string, reason?: string) => Promise<boolean>;
  isDeleting: boolean;
  isKicking: boolean;

  // Nametag resolution

  // Admin actions (relay admin only)
  isRelayAdmin: boolean;
  createGroup: (options: CreateGroupOptions) => Promise<GroupData | null>;
  deleteGroup: (groupId: string) => Promise<boolean>;
  createInvite: (groupId: string) => Promise<string | null>;
  isCreatingGroup: boolean;
  isDeletingGroup: boolean;
  isCreatingInvite: boolean;

  // Identity
  myPubkey: string | null;
  isAdminOfGroup: (groupId: string) => boolean;
}

export const useGroupChat = (): UseGroupChatReturn => {
  const queryClient = useQueryClient();
  const { groupChat, isGroupChatConnected } = useServices();
  const { sphere } = useSphereContext();
  const [selectedGroup, setSelectedGroup] = useState<GroupData | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Ref to avoid event subscription churn on group selection changes
  const selectedGroupRef = useRef(selectedGroup);
  selectedGroupRef.current = selectedGroup;

  // Listen for SDK group chat events (stable — no selectedGroup dependency)
  useEffect(() => {
    if (!sphere) return;

    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      const current = selectedGroupRef.current;
      if (current) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MESSAGES(current.id),
        });
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    };

    const handleMessage = (message: GroupMessageData) => {
      const current = selectedGroupRef.current;
      // If we're viewing this group, refetch messages and members
      if (current && message.groupId === current.id) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MESSAGES(current.id),
        });
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MEMBERS(current.id),
        });
        // Auto-mark as read since user is viewing
        groupChat?.markGroupAsRead(current.id);
      }
      // Always refetch groups for updated last message
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    };

    const handleKicked = (data: { groupId: string }) => {
      if (selectedGroupRef.current?.id === data.groupId) {
        setSelectedGroup(null);
      }
    };

    const handleGroupDeleted = (data: { groupId: string }) => {
      if (selectedGroupRef.current?.id === data.groupId) {
        setSelectedGroup(null);
      }
    };

    const unsubs = [
      sphere.on('groupchat:updated', handleUpdate),
      sphere.on('groupchat:message', handleMessage),
      sphere.on('groupchat:kicked', handleKicked),
      sphere.on('groupchat:group_deleted', handleGroupDeleted),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [sphere, queryClient, groupChat]);

  // Query joined groups
  const groupsQuery = useQuery({
    queryKey: QUERY_KEYS.GROUPS,
    queryFn: () => {
      if (!groupChat) return [];
      const groups = groupChat.getGroups();
      // Sort by last message time (descending)
      return [...groups].sort(
        (a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0)
      );
    },
    staleTime: 30000,
    enabled: !!groupChat,
  });

  // Restore selected group from localStorage when groups are loaded
  useEffect(() => {
    if (groupsQuery.data && groupsQuery.data.length > 0 && !selectedGroup) {
      const savedGroupId = localStorage.getItem(STORAGE_KEYS.CHAT_SELECTED_GROUP);
      if (savedGroupId) {
        const savedGroup = groupsQuery.data.find((g) => g.id === savedGroupId);
        if (savedGroup) {
          setSelectedGroup(savedGroup);
        }
      }
    }
  }, [groupsQuery.data, selectedGroup]);

  // Query available groups (for discovery)
  const availableGroupsQuery = useQuery({
    queryKey: QUERY_KEYS.AVAILABLE_GROUPS,
    queryFn: async () => {
      if (!groupChat) return [];
      return groupChat.fetchAvailableGroups();
    },
    staleTime: 60000,
    enabled: !!groupChat,
  });

  // Query messages for selected group
  const messagesQuery = useQuery({
    queryKey: QUERY_KEYS.MESSAGES(selectedGroup?.id || ''),
    queryFn: () => {
      if (!selectedGroup || !groupChat) return [];
      const messages = groupChat.getMessages(selectedGroup.id);
      return [...messages].sort((a, b) => a.timestamp - b.timestamp);
    },
    enabled: !!selectedGroup && !!groupChat,
    staleTime: 10000,
  });

  // Query members for selected group
  const membersQuery = useQuery({
    queryKey: QUERY_KEYS.MEMBERS(selectedGroup?.id || ''),
    queryFn: () => {
      if (!selectedGroup || !groupChat) return [];
      const members = groupChat.getMembers(selectedGroup.id);
      return [...members].sort((a, b) => a.joinedAt - b.joinedAt);
    },
    enabled: !!selectedGroup && !!groupChat,
    staleTime: 60000,
  });

  // Query total unread count
  const unreadCountQuery = useQuery({
    queryKey: QUERY_KEYS.UNREAD_COUNT,
    queryFn: () => groupChat?.getTotalUnreadCount() ?? 0,
    staleTime: 30000,
    enabled: !!groupChat,
  });

  // Query relay admin status
  const relayAdminQuery = useQuery({
    queryKey: QUERY_KEYS.RELAY_ADMIN,
    queryFn: async () => {
      if (!groupChat) return false;
      return groupChat.isCurrentUserRelayAdmin();
    },
    staleTime: 300000,
    enabled: !!groupChat && isGroupChatConnected,
  });

  // Join group mutation
  const joinGroupMutation = useMutation({
    mutationFn: async ({ groupId, inviteCode }: { groupId: string; inviteCode?: string }) => {
      if (!groupChat) throw new Error('Group chat not available');
      return groupChat.joinGroup(groupId, inviteCode);
    },
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AVAILABLE_GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MESSAGES(groupId) });
    },
  });

  // Leave group mutation
  const leaveGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      if (!groupChat) throw new Error('Group chat not available');
      return groupChat.leaveGroup(groupId);
    },
    onSuccess: (_, groupId) => {
      if (selectedGroup?.id === groupId) {
        setSelectedGroup(null);
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AVAILABLE_GROUPS });
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, replyToId }: { content: string; replyToId?: string }) => {
      if (!selectedGroup) throw new Error('No group selected');
      if (!groupChat) throw new Error('Group chat not available');

      const message = await groupChat.sendMessage(selectedGroup.id, content, replyToId);
      return !!message;
    },
    onSuccess: () => {
      setMessageInput('');
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.MESSAGES(selectedGroup?.id || ''),
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
    },
  });

  // Select group
  const selectGroup = useCallback(
    async (group: GroupData | null) => {
      setSelectedGroup(group);
      if (group) {
        localStorage.setItem(STORAGE_KEYS.CHAT_SELECTED_GROUP, group.id);
        groupChat?.markGroupAsRead(group.id);
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });

        // Fetch messages from relay if none exist locally
        const localMessages = groupChat?.getMessages(group.id) ?? [];
        if (localMessages.length === 0 && groupChat) {
          await groupChat.fetchMessages(group.id);
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MESSAGES(group.id) });
        }
      } else {
        localStorage.removeItem(STORAGE_KEYS.CHAT_SELECTED_GROUP);
      }
    },
    [queryClient, groupChat]
  );

  // Join group
  const joinGroup = useCallback(
    async (groupId: string, inviteCode?: string): Promise<boolean> => {
      const success = await joinGroupMutation.mutateAsync({ groupId, inviteCode });
      if (success) {
        const joinedGroup = groupChat?.getGroup(groupId);
        if (joinedGroup) {
          setSelectedGroup(joinedGroup);
          localStorage.setItem(STORAGE_KEYS.CHAT_SELECTED_GROUP, joinedGroup.id);
          groupChat?.markGroupAsRead(joinedGroup.id);
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
        }
      }
      return success;
    },
    [joinGroupMutation, queryClient, groupChat]
  );

  // Leave group
  const leaveGroup = useCallback(
    async (groupId: string): Promise<boolean> => {
      return leaveGroupMutation.mutateAsync(groupId);
    },
    [leaveGroupMutation]
  );

  // Send message
  const sendMessage = useCallback(
    async (content: string, replyToId?: string): Promise<boolean> => {
      if (!content.trim()) return false;
      return sendMessageMutation.mutateAsync({ content, replyToId });
    },
    [sendMessageMutation]
  );

  // Mark as read
  const markAsRead = useCallback(
    (groupId: string) => {
      groupChat?.markGroupAsRead(groupId);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    },
    [queryClient, groupChat]
  );

  // Refresh available groups
  const refreshAvailableGroups = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AVAILABLE_GROUPS });
  }, [queryClient]);

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    const groups = groupsQuery.data || [];
    if (!searchQuery.trim()) return groups;

    const query = searchQuery.toLowerCase();
    return groups.filter(
      (g) =>
        getGroupDisplayName(g).toLowerCase().includes(query) ||
        g.description?.toLowerCase().includes(query) ||
        (g.lastMessageText ?? '').toLowerCase().includes(query)
    );
  }, [groupsQuery.data, searchQuery]);

  // Moderation: Check if current user is admin/moderator
  const isCurrentUserAdmin = useMemo(() => {
    if (!selectedGroup || !groupChat) return false;
    return groupChat.isCurrentUserAdmin(selectedGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, groupChat, membersQuery.data]);

  const isCurrentUserModerator = useMemo(() => {
    if (!selectedGroup || !groupChat) return false;
    return groupChat.isCurrentUserModerator(selectedGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, groupChat, membersQuery.data]);

  // Delete message mutation
  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!selectedGroup) throw new Error('No group selected');
      if (!groupChat) throw new Error('Group chat not available');
      return groupChat.deleteMessage(selectedGroup.id, messageId);
    },
    onSuccess: () => {
      if (selectedGroup) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MESSAGES(selectedGroup.id),
        });
      }
    },
  });

  // Kick user mutation
  const kickUserMutation = useMutation({
    mutationFn: async ({ userPubkey, reason }: { userPubkey: string; reason?: string }) => {
      if (!selectedGroup) throw new Error('No group selected');
      if (!groupChat) throw new Error('Group chat not available');
      return groupChat.kickUser(selectedGroup.id, userPubkey, reason);
    },
    onSuccess: () => {
      if (selectedGroup) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MEMBERS(selectedGroup.id),
        });
      }
    },
  });

  // Delete message
  const deleteMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      return deleteMessageMutation.mutateAsync(messageId);
    },
    [deleteMessageMutation]
  );

  // Kick user
  const kickUser = useCallback(
    async (userPubkey: string, reason?: string): Promise<boolean> => {
      return kickUserMutation.mutateAsync({ userPubkey, reason });
    },
    [kickUserMutation]
  );

  // Create group mutation (admin)
  const createGroupMutation = useMutation({
    mutationFn: async (options: CreateGroupOptions) => {
      if (!groupChat) throw new Error('Group chat not available');
      return groupChat.createGroup(options);
    },
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AVAILABLE_GROUPS });
      if (group) {
        setSelectedGroup(group);
      }
    },
  });

  // Delete group mutation (admin)
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      if (!groupChat) throw new Error('Group chat not available');
      return groupChat.deleteGroup(groupId);
    },
    onSuccess: (_, groupId) => {
      if (selectedGroup?.id === groupId) {
        setSelectedGroup(null);
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AVAILABLE_GROUPS });
    },
  });

  // Create invite mutation (admin)
  const createInviteMutation = useMutation({
    mutationFn: async (groupId: string) => {
      if (!groupChat) throw new Error('Group chat not available');
      return groupChat.createInvite(groupId);
    },
  });

  // Create group
  const createGroup = useCallback(
    async (options: CreateGroupOptions): Promise<GroupData | null> => {
      return createGroupMutation.mutateAsync(options);
    },
    [createGroupMutation]
  );

  // Delete group
  const deleteGroup = useCallback(
    async (groupId: string): Promise<boolean> => {
      return deleteGroupMutation.mutateAsync(groupId);
    },
    [deleteGroupMutation]
  );

  // Create invite
  const createInvite = useCallback(
    async (groupId: string): Promise<string | null> => {
      return createInviteMutation.mutateAsync(groupId);
    },
    [createInviteMutation]
  );

  // Identity helpers
  const myPubkey = useMemo(() => groupChat?.getMyPublicKey() ?? null, [groupChat]);

  const isAdminOfGroup = useCallback(
    (groupId: string): boolean => {
      return groupChat?.isCurrentUserAdmin(groupId) ?? false;
    },
    [groupChat]
  );

  return {
    // Groups
    groups: groupsQuery.data || [],
    isLoadingGroups: groupsQuery.isLoading,
    selectedGroup,
    selectGroup,
    joinGroup,
    leaveGroup,

    // Discovery
    availableGroups: availableGroupsQuery.data || [],
    isLoadingAvailable: availableGroupsQuery.isLoading,
    refreshAvailableGroups,

    // Messages
    messages: messagesQuery.data || [],
    isLoadingMessages: messagesQuery.isLoading,
    sendMessage,
    isSending: sendMessageMutation.isPending,

    // Members
    members: membersQuery.data || [],
    isLoadingMembers: membersQuery.isLoading,

    // Input state
    messageInput,
    setMessageInput,

    // Unread
    totalUnreadCount: unreadCountQuery.data || 0,
    markAsRead,

    // Search/Filter
    searchQuery,
    setSearchQuery,
    filteredGroups,

    // Connection
    isConnected: isGroupChatConnected,

    // Moderation
    isCurrentUserAdmin,
    isCurrentUserModerator,
    deleteMessage,
    kickUser,
    isDeleting: deleteMessageMutation.isPending,
    isKicking: kickUserMutation.isPending,

    // Admin actions (relay admin only)
    isRelayAdmin: relayAdminQuery.data || false,
    createGroup,
    deleteGroup,
    createInvite,
    isCreatingGroup: createGroupMutation.isPending,
    isDeletingGroup: deleteGroupMutation.isPending,
    isCreatingInvite: createInviteMutation.isPending,

    // Identity
    myPubkey,
    isAdminOfGroup,
  };
};
