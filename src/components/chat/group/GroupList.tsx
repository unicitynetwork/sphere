import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, X, PanelLeftClose, Sparkles, Hash } from 'lucide-react';
import type { GroupData } from '@unicitylabs/sphere-sdk';
import { GroupItem } from './GroupItem';

interface GroupListProps {
  groups: GroupData[];
  selectedGroup: GroupData | null;
  onSelect: (group: GroupData) => void;
  onLeave: (groupId: string) => void;
  onJoinGroup: () => void;
  onCreateGroup: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onCollapse: () => void;
  // Admin features
  isRelayAdmin: boolean;
  isAdminOfGroup: (groupId: string) => boolean;
  onDeleteGroup: (groupId: string) => Promise<boolean>;
  onCreateInvite: (groupId: string) => Promise<string | null>;
  isDeletingGroup: boolean;
  isCreatingInvite: boolean;
}

export function GroupList({
  groups,
  selectedGroup,
  onSelect,
  onLeave,
  onJoinGroup,
  onCreateGroup,
  searchQuery,
  onSearchChange,
  isOpen,
  onClose,
  isCollapsed,
  onCollapse,
  isRelayAdmin,
  isAdminOfGroup,
  onDeleteGroup,
  onCreateInvite,
  isDeletingGroup,
  isCreatingInvite,
}: GroupListProps) {
  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden absolute inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <div
        className={`
        w-72 border-r border-neutral-200 dark:border-neutral-800/50 flex flex-col z-50 overflow-hidden
        absolute lg:relative inset-y-0 left-0 min-h-0
        transform transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isCollapsed ? 'lg:w-0 lg:border-0 lg:min-w-0' : 'lg:w-72'}
        bg-white/95 dark:bg-neutral-900/95 lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-none
      `}
      >
        {/* Header */}
        <div className="shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800/50 bg-linear-to-br from-white/80 dark:from-neutral-900/80 to-neutral-50/40 dark:to-neutral-800/40 backdrop-blur-sm relative">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full" />

          <div className="flex items-center justify-between mb-3 relative z-10">
            <div className="flex items-center gap-2">
              <h3 className="text-neutral-900 dark:text-white font-medium">Groups</h3>
              <Sparkles className="w-4 h-4 text-blue-500 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              {/* Create group button - available to all users */}
              <motion.button
                onClick={onCreateGroup}
                className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
                title="Create group"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Hash className="w-4 h-4" />
              </motion.button>
              {/* Join group button */}
              <motion.button
                onClick={onJoinGroup}
                className="p-2 rounded-lg bg-linear-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/30"
                title="Browse groups"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Plus className="w-4 h-4" />
              </motion.button>
              {/* Collapse button for desktop */}
              <motion.button
                onClick={onCollapse}
                className="hidden lg:flex p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
                title="Collapse sidebar"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <PanelLeftClose className="w-4 h-4" />
              </motion.button>
              {/* Close button for mobile */}
              <motion.button
                onClick={onClose}
                className="lg:hidden p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          {/* Search */}
          <div className="relative z-10">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search groups..."
              className="w-full pl-9 pr-3 py-2 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-white placeholder-neutral-400 rounded-xl text-sm border border-neutral-200 dark:border-neutral-700/50 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Group List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center mb-4">
                <Hash className="w-8 h-8 text-neutral-400" />
              </div>
              <p className="text-neutral-500 dark:text-neutral-400 text-sm">
                No groups yet
              </p>
              <p className="text-neutral-400 dark:text-neutral-500 text-xs mt-1">
                Join a group to start chatting
              </p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {groups.map((group) => (
                <motion.div
                  key={group.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  layout
                >
                  <GroupItem
                    group={group}
                    isSelected={selectedGroup?.id === group.id}
                    onClick={() => onSelect(group)}
                    onLeave={() => onLeave(group.id)}
                    isAdmin={isAdminOfGroup(group.id)}
                    isRelayAdmin={isRelayAdmin}
                    onDeleteGroup={() => onDeleteGroup(group.id)}
                    onCreateInvite={() => onCreateInvite(group.id)}
                    isDeletingGroup={isDeletingGroup}
                    isCreatingInvite={isCreatingInvite}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </>
  );
}
