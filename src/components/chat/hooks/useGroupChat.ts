import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { GroupData, GroupMessageData, GroupMemberData, CreateGroupOptions } from '@unicitylabs/sphere-sdk';
import { GroupVisibility } from '@unicitylabs/sphere-sdk';
import { useServices } from '../../../contexts/useServices';
import { useSphereContext } from '../../../sdk/hooks/core/useSphere';
import { useIdentity } from '../../../sdk/hooks/core/useIdentity';
import { STORAGE_KEYS } from '../../../config/storageKeys';
import { getGroupDisplayName } from '../utils/groupChatHelpers';
import { buildAddressId } from '../data/chatTypes';

const groupChatKeys = (addressId: string) => ({
  all: ['groupChat', addressId] as const,
  groups: ['groupChat', 'groups', addressId] as const,
  messages: (groupId: string) => ['groupChat', 'messages', addressId, groupId] as const,
  members: (groupId: string) => ['groupChat', 'members', addressId, groupId] as const,
  available: ['groupChat', 'available', addressId] as const,
  unreadCount: ['groupChat', 'unreadCount', addressId] as const,
  relayAdmin: ['groupChat', 'relayAdmin', addressId] as const,
});

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

  // Lazy loading
  hasMore: boolean;
  loadMore: () => void;

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
  canModerateSelectedGroup: boolean;
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
  const { directAddress } = useIdentity();
  const addressId = directAddress ? buildAddressId(directAddress) : 'default';
  const KEYS = useMemo(() => groupChatKeys(addressId), [addressId]);
  const [selectedGroup, setSelectedGroup] = useState<GroupData | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [messageLimit, setMessageLimit] = useState(20);
  // Address-scoped selected group key
  const selectedGroupKey = `${STORAGE_KEYS.CHAT_SELECTED_GROUP}_${addressId}`;

  // Reset local state when address changes (address switch)
  const prevAddressIdRef = useRef(addressId);
  useEffect(() => {
    if (prevAddressIdRef.current !== addressId) {
      prevAddressIdRef.current = addressId;
      setSelectedGroup(null);
      setSearchQuery('');
      setMessageLimit(20);
    }
  }, [addressId]);

  // Ref to avoid event subscription churn on group selection changes
  const selectedGroupRef = useRef(selectedGroup);
  selectedGroupRef.current = selectedGroup;

  // Listen for SDK group chat events (stable — no selectedGroup dependency)
  useEffect(() => {
    if (!sphere) return;

    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: KEYS.groups });
      const current = selectedGroupRef.current;
      if (current) {
        queryClient.invalidateQueries({
          queryKey: KEYS.messages(current.id),
        });
      }
      queryClient.invalidateQueries({ queryKey: KEYS.unreadCount });
    };

    const handleMessage = (message: GroupMessageData) => {
      const current = selectedGroupRef.current;
      // If we're viewing this group, refetch messages and members
      if (current && message.groupId === current.id) {
        queryClient.invalidateQueries({
          queryKey: KEYS.messages(current.id),
        });
        queryClient.invalidateQueries({
          queryKey: KEYS.members(current.id),
        });
        // Auto-mark as read since user is viewing
        groupChat?.markGroupAsRead(current.id);
      }
      // Always refetch groups for updated last message
      queryClient.invalidateQueries({ queryKey: KEYS.groups });
      queryClient.invalidateQueries({ queryKey: KEYS.unreadCount });
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
  }, [sphere, queryClient, groupChat, KEYS]);

  // Query joined groups
  const groupsQuery = useQuery({
    queryKey: KEYS.groups,
    queryFn: () => {
      if (!groupChat) return [];
      const groups = groupChat.getGroups();
      // Pin "General" first, then sort by last message time (descending)
      return [...groups].sort((a, b) => {
        const aGeneral = a.name?.toLowerCase() === 'general' ? 1 : 0;
        const bGeneral = b.name?.toLowerCase() === 'general' ? 1 : 0;
        if (aGeneral !== bGeneral) return bGeneral - aGeneral;
        return (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0);
      });
    },
    staleTime: 30000,
    enabled: !!groupChat && isGroupChatConnected,
  });

  // Restore selected group from localStorage when groups are loaded, fallback to "General".
  // Also fetches messages from relay when the local cache is empty — fixes mobile layout
  // showing stale/old messages (auto-select previously skipped the fetch path).
  useEffect(() => {
    if (!groupsQuery.data || groupsQuery.data.length === 0 || selectedGroup) return;
    if (!groupChat) return;

    let target: GroupData | undefined;

    const savedGroupId = localStorage.getItem(selectedGroupKey);
    if (savedGroupId) {
      target = groupsQuery.data.find((g) => g.id === savedGroupId);
    }
    if (!target) {
      target = groupsQuery.data.find((g) => g.name?.toLowerCase() === 'general');
    }

    if (target) {
      setSelectedGroup(target);
      localStorage.setItem(selectedGroupKey, target.id);
      groupChat.markGroupAsRead(target.id);

      // Fetch messages from relay if none exist locally (same as selectGroup)
      const localMessages = groupChat.getMessages(target.id);
      if (localMessages.length === 0) {
        const groupId = target.id;
        groupChat.fetchMessages(groupId).then(() => {
          queryClient.invalidateQueries({ queryKey: KEYS.messages(groupId) });
        });
      }
    }
  }, [groupsQuery.data, selectedGroup, selectedGroupKey, groupChat, queryClient, KEYS]);

  // Query available groups (for discovery)
  const availableGroupsQuery = useQuery({
    queryKey: KEYS.available,
    queryFn: async () => {
      if (!groupChat) return [];
      return groupChat.fetchAvailableGroups();
    },
    staleTime: 60000,
    enabled: !!groupChat && isGroupChatConnected,
  });

  // Reset message limit when switching groups
  useEffect(() => {
    setMessageLimit(20);
  }, [selectedGroup?.id]);

  // Query messages for selected group with lazy loading
  const messagesQuery = useQuery({
    queryKey: [...KEYS.messages(selectedGroup?.id || ''), messageLimit],
    queryFn: () => {
      if (!selectedGroup || !groupChat) return { messages: [] as GroupMessageData[], hasMore: false };
      const allMessages = groupChat.getMessages(selectedGroup.id);
      const sorted = [...allMessages].sort((a, b) => a.timestamp - b.timestamp);
      const total = sorted.length;
      const sliced = total > messageLimit ? sorted.slice(total - messageLimit) : sorted;
      return { messages: sliced, hasMore: total > messageLimit };
    },
    enabled: !!selectedGroup && !!groupChat,
    staleTime: 10000,
    placeholderData: keepPreviousData,
  });

  // Load more messages
  const loadMore = useCallback(() => {
    setMessageLimit((prev) => prev + 20);
  }, []);

  // Query members for selected group
  const membersQuery = useQuery({
    queryKey: KEYS.members(selectedGroup?.id || ''),
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
    queryKey: KEYS.unreadCount,
    queryFn: () => groupChat?.getTotalUnreadCount() ?? 0,
    staleTime: 30000,
    enabled: !!groupChat && isGroupChatConnected,
  });

  // Query relay admin status
  const relayAdminQuery = useQuery({
    queryKey: KEYS.relayAdmin,
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
      queryClient.invalidateQueries({ queryKey: KEYS.groups });
      queryClient.invalidateQueries({ queryKey: KEYS.available });
      queryClient.invalidateQueries({ queryKey: KEYS.messages(groupId) });
    },
  });

  // Leave group mutation
  const leaveGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      if (!groupChat) throw new Error('Group chat not available');
      const success = await groupChat.leaveGroup(groupId);
      if (!success) throw new Error('Failed to leave group');
      return true;
    },
    onSuccess: (_, groupId) => {
      if (selectedGroup?.id === groupId) {
        setSelectedGroup(null);
        localStorage.removeItem(selectedGroupKey);
      }
      queryClient.invalidateQueries({ queryKey: KEYS.groups });
      queryClient.invalidateQueries({ queryKey: KEYS.available });
      queryClient.invalidateQueries({ queryKey: KEYS.unreadCount });
    },
    onError: (err, groupId) => {
      console.error(`[useGroupChat] Failed to leave group ${groupId}:`, err);
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
        queryKey: KEYS.messages(selectedGroup?.id || ''),
      });
      queryClient.invalidateQueries({ queryKey: KEYS.groups });
    },
  });

  // Select group
  const selectGroup = useCallback(
    async (group: GroupData | null) => {
      setSelectedGroup(group);
      if (group) {
        localStorage.setItem(selectedGroupKey, group.id);
        groupChat?.markGroupAsRead(group.id);
        queryClient.invalidateQueries({ queryKey: KEYS.unreadCount });

        // Fetch messages from relay if none exist locally
        const localMessages = groupChat?.getMessages(group.id) ?? [];
        if (localMessages.length === 0 && groupChat) {
          await groupChat.fetchMessages(group.id);
          queryClient.invalidateQueries({ queryKey: KEYS.messages(group.id) });
        }
      } else {
        localStorage.removeItem(selectedGroupKey);
      }
    },
    [queryClient, groupChat, KEYS, selectedGroupKey]
  );

  // Join group
  const joinGroup = useCallback(
    async (groupId: string, inviteCode?: string): Promise<boolean> => {
      const success = await joinGroupMutation.mutateAsync({ groupId, inviteCode });
      if (success) {
        const joinedGroup = groupChat?.getGroup(groupId);
        if (joinedGroup) {
          setSelectedGroup(joinedGroup);
          localStorage.setItem(selectedGroupKey, joinedGroup.id);
          groupChat?.markGroupAsRead(joinedGroup.id);
          queryClient.invalidateQueries({ queryKey: KEYS.unreadCount });
        }
      }
      return success;
    },
    [joinGroupMutation, queryClient, groupChat, KEYS, selectedGroupKey]
  );

  // Leave group
  const leaveGroup = useCallback(
    async (groupId: string): Promise<boolean> => {
      try {
        return await leaveGroupMutation.mutateAsync(groupId);
      } catch {
        return false;
      }
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
      queryClient.invalidateQueries({ queryKey: KEYS.unreadCount });
    },
    [queryClient, groupChat, KEYS]
  );

  // Refresh available groups
  const refreshAvailableGroups = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: KEYS.available });
  }, [queryClient, KEYS]);

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

  // Combined moderation check: group admin/moderator OR relay admin on public groups
  const canModerateSelectedGroup = useMemo(() => {
    if (!selectedGroup || !groupChat) return false;
    if (groupChat.isCurrentUserAdmin(selectedGroup.id) || groupChat.isCurrentUserModerator(selectedGroup.id)) {
      return true;
    }
    if (relayAdminQuery.data && selectedGroup.visibility === GroupVisibility.PUBLIC) {
      return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, groupChat, membersQuery.data, relayAdminQuery.data]);

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
          queryKey: KEYS.messages(selectedGroup.id),
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
          queryKey: KEYS.members(selectedGroup.id),
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
      queryClient.invalidateQueries({ queryKey: KEYS.groups });
      queryClient.invalidateQueries({ queryKey: KEYS.available });
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
      queryClient.invalidateQueries({ queryKey: KEYS.groups });
      queryClient.invalidateQueries({ queryKey: KEYS.available });
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

  // Identity helpers — addressId forces recomputation on address switch
  const myPubkey = useMemo(() => groupChat?.getMyPublicKey() ?? null, [groupChat, addressId]);

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
    messages: messagesQuery.data?.messages || [],
    isLoadingMessages: messagesQuery.isLoading,
    sendMessage,
    isSending: sendMessageMutation.isPending,

    // Lazy loading
    hasMore: messagesQuery.data?.hasMore ?? false,
    loadMore,

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
    canModerateSelectedGroup,
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
