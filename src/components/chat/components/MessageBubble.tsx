import { motion } from 'framer-motion';
import { ShoppingBag } from 'lucide-react';
import type { IMessage } from '../../../types';

interface MessageBubbleProps {
  msg: IMessage;
  isFirst: boolean;
  delay: number;
}

export function MessageBubble({ msg, delay }: MessageBubbleProps) {
  const isOwn = msg.isOwn;

  // Render context card (product card) differently
  if (msg.isContextCard && msg.productCard) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: delay }}
        className="flex justify-center mb-4"
      >
        <div className="bg-neutral-100 dark:bg-neutral-800/80 backdrop-blur-sm rounded-2xl border border-neutral-200 dark:border-neutral-700/50 overflow-hidden max-w-[280px] w-full">
          <div className="relative">
            <img
              src={msg.productCard.image}
              alt={msg.productCard.title}
              className="w-full h-32 object-cover"
            />
            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg">
              <div className="flex items-center gap-1.5 text-xs text-white/80">
                <ShoppingBag className="w-3 h-3" />
                <span>P2P Trade</span>
              </div>
            </div>
          </div>
          <div className="p-3">
            <p className="text-neutral-900 dark:text-white font-medium">{msg.productCard.title}</p>
            {msg.productCard.price && (
              <p className="text-orange-500 dark:text-orange-400 font-bold mt-1">${msg.productCard.price}</p>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay }}
      className={`flex gap-4 ${isOwn ? 'flex-row-reverse' : ''}`}
    >
      {!isOwn && (
        <div className="relative">
          <div className="relative w-10 h-10 rounded-lg bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white text-sm shrink-0 shadow-lg">
            {msg.avatar}
          </div>
        </div>
      )}

      <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[70%]`}>
        {!isOwn && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 px-1">{msg.sender}</div>
        )}
        <motion.div
          whileHover={{ scale: 1.02 }}
          className={`rounded-2xl px-6 py-4 relative overflow-hidden ${
            isOwn
              ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-xl shadow-orange-500/20'
              : 'bg-neutral-100 dark:bg-neutral-800/80 backdrop-blur-sm text-neutral-800 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700/50'
          }`}
        >
          {isOwn && (
            <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/10 to-white/0" />
          )}

          <div className="text-sm leading-relaxed relative z-10">{msg.content}</div>
        </motion.div>
        <div className="text-xs text-neutral-500 mt-1 px-1">{msg.timestamp}</div>
      </div>
    </motion.div>
  );
}
