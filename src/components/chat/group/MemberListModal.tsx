import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, ShieldCheck, User, UserMinus, Loader2 } from 'lucide-react';
import type { GroupMemberData } from '@unicitylabs/sphere-sdk';
import { GroupRole } from '@unicitylabs/sphere-sdk';
import { getMemberAvatar } from '../utils/groupChatHelpers';

interface MemberListModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: GroupMemberData[];
  isLoading: boolean;
  isCurrentUserAdmin: boolean;
  myPubkey: string | null;
  onKickUser?: (userPubkey: string, reason?: string) => Promise<boolean>;
  isKicking?: boolean;
}

export function MemberListModal({
  isOpen,
  onClose,
  members,
  isLoading,
  isCurrentUserAdmin,
  myPubkey,
  onKickUser,
  isKicking = false,
}: MemberListModalProps) {
  const [kickingPubkey, setKickingPubkey] = useState<string | null>(null);
  const [showKickConfirm, setShowKickConfirm] = useState<string | null>(null);

  const handleKickClick = (pubkey: string) => {
    setShowKickConfirm(pubkey);
  };

  const handleConfirmKick = async (pubkey: string) => {
    if (!onKickUser) return;

    setKickingPubkey(pubkey);
    try {
      await onKickUser(pubkey);
    } finally {
      setKickingPubkey(null);
      setShowKickConfirm(null);
    }
  };

  const handleCancelKick = () => {
    setShowKickConfirm(null);
  };

  const getRoleIcon = (role: typeof GroupRole[keyof typeof GroupRole]) => {
    switch (role) {
      case GroupRole.ADMIN:
        return <ShieldCheck className="w-4 h-4 text-amber-500" />;
      case GroupRole.MODERATOR:
        return <Shield className="w-4 h-4 text-blue-500" />;
      default:
        return <User className="w-4 h-4 text-neutral-400" />;
    }
  };

  const getRoleBadge = (role: typeof GroupRole[keyof typeof GroupRole]) => {
    switch (role) {
      case GroupRole.ADMIN:
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
            Admin
          </span>
        );
      case GroupRole.MODERATOR:
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            Mod
          </span>
        );
      default:
        return null;
    }
  };

  // Sort members: admins first, then moderators, then regular members
  const sortedMembers = [...members].sort((a, b) => {
    const roleOrder = { [GroupRole.ADMIN]: 0, [GroupRole.MODERATOR]: 1, [GroupRole.MEMBER]: 2 };
    return roleOrder[a.role] - roleOrder[b.role];
  });

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100000]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-x-4 top-20 bottom-8 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md md:max-h-[70vh] bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl z-[100000] flex flex-col overflow-hidden border border-neutral-200 dark:border-neutral-800"
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
                  Members ({members.length})
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Member List */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 dark:text-neutral-400">
                  No members found
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedMembers.map((member) => {
                    const isMe = member.pubkey === myPubkey;
                    const canKick = isCurrentUserAdmin && !isMe && member.role !== GroupRole.ADMIN;
                    const isBeingKicked = kickingPubkey === member.pubkey;
                    const showConfirm = showKickConfirm === member.pubkey;

                    return (
                      <motion.div
                        key={member.pubkey}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50"
                      >
                        {/* Avatar */}
                        <div className="shrink-0 w-10 h-10 rounded-lg bg-linear-to-br from-blue-500 to-purple-600 text-white text-sm font-medium flex items-center justify-center">
                          {getMemberAvatar(member)}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {getRoleIcon(member.role)}
                            {member.nametag && (
                              <>
                                <span className="text-xs text-neutral-500 dark:text-neutral-400">Unicity ID:</span>
                                <span className="font-medium text-neutral-900 dark:text-white">
                                  @{member.nametag.replace('@', '')}
                                </span>
                              </>
                            )}
                            {isMe && (
                              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                (you)
                              </span>
                            )}
                            {getRoleBadge(member.role)}
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 break-all font-mono mt-1">
                            {member.pubkey}
                          </p>
                        </div>

                        {/* Kick button/confirmation */}
                        {canKick && (
                          <div className="shrink-0">
                            <AnimatePresence mode="wait">
                              {showConfirm ? (
                                <motion.div
                                  key="confirm"
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.9 }}
                                  className="flex items-center gap-1"
                                >
                                  <button
                                    onClick={() => handleConfirmKick(member.pubkey)}
                                    disabled={isKicking}
                                    className="px-2 py-1 text-xs font-medium rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
                                  >
                                    {isBeingKicked ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      'Kick'
                                    )}
                                  </button>
                                  <button
                                    onClick={handleCancelKick}
                                    disabled={isKicking}
                                    className="px-2 py-1 text-xs font-medium rounded-lg bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-200 transition-colors"
                                  >
                                    No
                                  </button>
                                </motion.div>
                              ) : (
                                <motion.button
                                  key="kick"
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.9 }}
                                  onClick={() => handleKickClick(member.pubkey)}
                                  className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                  title="Kick member"
                                >
                                  <UserMinus className="w-4 h-4" />
                                </motion.button>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer with admin info */}
            {isCurrentUserAdmin && (
              <div className="shrink-0 p-4 border-t border-neutral-200 dark:border-neutral-800 bg-amber-50 dark:bg-amber-900/20">
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  You are an admin. Click the kick icon to remove members.
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
