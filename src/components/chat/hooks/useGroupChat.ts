import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GroupChatRepository } from '../data/GroupChatRepository';
import { Group, GroupMessage, GroupMember } from '../data/groupModels';
import { useServices } from '../../../contexts/useServices';

const QUERY_KEYS = {
  GROUPS: ['groupChat', 'groups'],
  MESSAGES: (groupId: string) => ['groupChat', 'messages', groupId],
  MEMBERS: (groupId: string) => ['groupChat', 'members', groupId],
  AVAILABLE_GROUPS: ['groupChat', 'available'],
  UNREAD_COUNT: ['groupChat', 'unreadCount'],
};

const groupRepository = GroupChatRepository.getInstance();

export interface UseGroupChatReturn {
  // Groups
  groups: Group[];
  isLoadingGroups: boolean;
  selectedGroup: Group | null;
  selectGroup: (group: Group | null) => void;
  joinGroup: (groupId: string, inviteCode?: string) => Promise<boolean>;
  leaveGroup: (groupId: string) => Promise<boolean>;

  // Discovery
  availableGroups: Group[];
  isLoadingAvailable: boolean;
  refreshAvailableGroups: () => void;

  // Messages
  messages: GroupMessage[];
  isLoadingMessages: boolean;
  sendMessage: (content: string, replyToId?: string) => Promise<boolean>;
  isSending: boolean;

  // Members
  members: GroupMember[];
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
  filteredGroups: Group[];

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
  resolveMemberNametags: () => Promise<void>;
}

export const useGroupChat = (): UseGroupChatReturn => {
  const queryClient = useQueryClient();
  const { groupChatService } = useServices();
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  // Initialize service connection
  useEffect(() => {
    const initializeConnection = async () => {
      if (groupChatService) {
        await groupChatService.start();
        setIsConnected(groupChatService.getConnectionStatus());
      }
    };

    initializeConnection();
  }, [groupChatService]);

  // Listen for group chat updates
  useEffect(() => {
    const handleGroupChatUpdate = () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      if (selectedGroup) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MESSAGES(selectedGroup.id),
        });
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    };

    const handleGroupMessageReceived = (event: CustomEvent<GroupMessage>) => {
      const message = event.detail;
      // If we're viewing this group, refetch messages and members (nametags may have updated)
      if (selectedGroup && message.groupId === selectedGroup.id) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MESSAGES(selectedGroup.id),
        });
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MEMBERS(selectedGroup.id),
        });
        // Auto-mark as read since user is viewing
        groupRepository.markGroupAsRead(selectedGroup.id);
      }
      // Always refetch groups for updated last message
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    };

    const handleGroupKicked = (event: CustomEvent<{ groupId: string }>) => {
      const { groupId } = event.detail;
      // If we're viewing the group we were kicked from, deselect it
      if (selectedGroup && selectedGroup.id === groupId) {
        setSelectedGroup(null);
      }
    };

    window.addEventListener('group-chat-updated', handleGroupChatUpdate);
    window.addEventListener('group-message-received', handleGroupMessageReceived as EventListener);
    window.addEventListener('group-kicked', handleGroupKicked as EventListener);

    return () => {
      window.removeEventListener('group-chat-updated', handleGroupChatUpdate);
      window.removeEventListener('group-message-received', handleGroupMessageReceived as EventListener);
      window.removeEventListener('group-kicked', handleGroupKicked as EventListener);
    };
  }, [queryClient, selectedGroup]);

  // Query joined groups
  const groupsQuery = useQuery({
    queryKey: QUERY_KEYS.GROUPS,
    queryFn: () => groupRepository.getGroups(),
    staleTime: 30000,
  });

  // Query available groups (for discovery)
  const availableGroupsQuery = useQuery({
    queryKey: QUERY_KEYS.AVAILABLE_GROUPS,
    queryFn: async () => {
      if (!groupChatService) return [];
      return groupChatService.fetchAvailableGroups();
    },
    staleTime: 60000,
    enabled: !!groupChatService,
  });

  // Query messages for selected group
  const messagesQuery = useQuery({
    queryKey: QUERY_KEYS.MESSAGES(selectedGroup?.id || ''),
    queryFn: () => {
      if (!selectedGroup) return [];
      return groupRepository.getMessagesForGroup(selectedGroup.id);
    },
    enabled: !!selectedGroup,
    staleTime: 10000,
  });

  // Query members for selected group
  const membersQuery = useQuery({
    queryKey: QUERY_KEYS.MEMBERS(selectedGroup?.id || ''),
    queryFn: () => {
      if (!selectedGroup) return [];
      return groupRepository.getMembersForGroup(selectedGroup.id);
    },
    enabled: !!selectedGroup,
    staleTime: 60000,
  });

  // Query total unread count
  const unreadCountQuery = useQuery({
    queryKey: QUERY_KEYS.UNREAD_COUNT,
    queryFn: () => groupRepository.getTotalUnreadCount(),
    staleTime: 30000,
  });

  // Join group mutation
  const joinGroupMutation = useMutation({
    mutationFn: async ({ groupId, inviteCode }: { groupId: string; inviteCode?: string }) => {
      if (!groupChatService) throw new Error('Group chat service not available');
      return groupChatService.joinGroup(groupId, inviteCode);
    },
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.GROUPS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AVAILABLE_GROUPS });
      // Invalidate messages for the joined group so history is loaded
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MESSAGES(groupId) });
    },
  });

  // Leave group mutation
  const leaveGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      if (!groupChatService) throw new Error('Group chat service not available');
      return groupChatService.leaveGroup(groupId);
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
      if (!groupChatService) throw new Error('Group chat service not available');

      const message = await groupChatService.sendMessage(selectedGroup.id, content, replyToId);
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
    async (group: Group | null) => {
      setSelectedGroup(group);
      if (group) {
        groupRepository.markGroupAsRead(group.id);
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });

        // Fetch messages from relay if none exist locally (handles new joins)
        const localMessages = groupRepository.getMessagesForGroup(group.id);
        if (localMessages.length === 0 && groupChatService) {
          await groupChatService.fetchMessages(group.id);
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MESSAGES(group.id) });
        }
      }
    },
    [queryClient, groupChatService]
  );

  // Join group
  const joinGroup = useCallback(
    async (groupId: string, inviteCode?: string): Promise<boolean> => {
      return joinGroupMutation.mutateAsync({ groupId, inviteCode });
    },
    [joinGroupMutation]
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
      groupRepository.markGroupAsRead(groupId);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    },
    [queryClient]
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
        g.getDisplayName().toLowerCase().includes(query) ||
        g.description?.toLowerCase().includes(query) ||
        g.lastMessageText.toLowerCase().includes(query)
    );
  }, [groupsQuery.data, searchQuery]);

  // Moderation: Check if current user is admin/moderator
  // membersQuery.data is included to re-compute when members change (service reads from repository)
  const isCurrentUserAdmin = useMemo(() => {
    if (!selectedGroup || !groupChatService) return false;
    return groupChatService.isCurrentUserAdmin(selectedGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, groupChatService, membersQuery.data]);

  const isCurrentUserModerator = useMemo(() => {
    if (!selectedGroup || !groupChatService) return false;
    return groupChatService.isCurrentUserModerator(selectedGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, groupChatService, membersQuery.data]);

  // Delete message mutation
  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!selectedGroup) throw new Error('No group selected');
      if (!groupChatService) throw new Error('Group chat service not available');
      return groupChatService.deleteMessage(selectedGroup.id, messageId);
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
      if (!groupChatService) throw new Error('Group chat service not available');
      return groupChatService.kickUser(selectedGroup.id, userPubkey, reason);
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

  // Resolve member nametags
  const resolveMemberNametags = useCallback(async () => {
    if (!selectedGroup || !groupChatService) return;
    await groupChatService.resolveMemberNametags();
    // Invalidate members query to refresh the UI
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MEMBERS(selectedGroup.id) });
  }, [selectedGroup, groupChatService, queryClient]);

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
    isConnected,

    // Moderation
    isCurrentUserAdmin,
    isCurrentUserModerator,
    deleteMessage,
    kickUser,
    isDeleting: deleteMessageMutation.isPending,
    isKicking: kickUserMutation.isPending,

    // Nametag resolution
    resolveMemberNametags,
  };
};
