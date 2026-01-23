import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Hash, Lock, Globe, Loader2 } from 'lucide-react';
import { GroupVisibility } from '../data/groupModels';
import type { CreateGroupOptions } from '../services/GroupChatService';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (options: CreateGroupOptions) => Promise<unknown>;
  isCreating: boolean;
}

export function CreateGroupModal({
  isOpen,
  onClose,
  onCreate,
  isCreating,
}: CreateGroupModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<GroupVisibility>(GroupVisibility.PUBLIC);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Group name is required');
      return;
    }

    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
      });
      // Reset form and close
      setName('');
      setDescription('');
      setVisibility(GroupVisibility.PUBLIC);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setName('');
      setDescription('');
      setVisibility(GroupVisibility.PUBLIC);
      setError(null);
      onClose();
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100000]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl z-[100000] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <Hash className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
                  Create Group
                </h2>
              </div>
              <button
                onClick={handleClose}
                disabled={isCreating}
                className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Group Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter group name..."
                  disabled={isCreating}
                  className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 rounded-xl border border-neutral-200 dark:border-neutral-700 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this group about?"
                  disabled={isCreating}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 rounded-xl border border-neutral-200 dark:border-neutral-700 focus:outline-none focus:border-blue-500 transition-colors resize-none disabled:opacity-50"
                />
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Visibility
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setVisibility(GroupVisibility.PUBLIC)}
                    disabled={isCreating}
                    className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                      visibility === GroupVisibility.PUBLIC
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600'
                    } disabled:opacity-50`}
                  >
                    <Globe className="w-5 h-5" />
                    <div className="text-left">
                      <div className="font-medium text-sm">Public</div>
                      <div className="text-xs opacity-70">Anyone can join</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility(GroupVisibility.PRIVATE)}
                    disabled={isCreating}
                    className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                      visibility === GroupVisibility.PRIVATE
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600'
                    } disabled:opacity-50`}
                  >
                    <Lock className="w-5 h-5" />
                    <div className="text-left">
                      <div className="font-medium text-sm">Private</div>
                      <div className="text-xs opacity-70">Invite only</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isCreating || !name.trim()}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Group'
                )}
              </button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
