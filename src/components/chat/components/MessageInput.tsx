// src/components/chat/components/MessageInput.tsx
import { Send, Smile } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatState } from '../../../hooks/useChatState';

type InputProps = Pick<ChatState, 'chatMode' | 'selectedUser' | 'message' | 'setMessage' | 'handleSend'>;

export function MessageInput({ chatMode, selectedUser, message, setMessage, handleSend }: InputProps) {
  
  const placeholderText = `Message ${chatMode === 'global' ? 'global channel' : selectedUser?.name || 'user'}...`;
  
  return (
    <div className="border-t border-neutral-800/50 p-4 lg:p-6 bg-neutral-900/80 backdrop-blur-sm">
      {/* Decorative glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-1 bg-linear-to-r from-transparent via-orange-500/30 to-transparent" />
      
      <div className="flex items-center gap-4">
        <div className="flex-1 bg-neutral-800/60 backdrop-blur-sm rounded-2xl border border-neutral-700/50 focus-within:border-orange-500/50 focus-within:shadow-xl focus-within:shadow-orange-500/10 transition-all relative overflow-hidden group">
          
          {/* Focus glow */}
          <div className="absolute inset-0 bg-linear-to-r from-orange-500/0 via-orange-500/5 to-orange-500/0 opacity-0 group-focus-within:opacity-100 transition-opacity" />
          
          {/* НОВЫЙ Flex-контейнер для инпута и кнопок */}
          <div className="flex items-center w-full relative z-10">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={placeholderText}
              // Скорректированы классы для размещения в Flex-контейнере
              className="flex-1 bg-transparent px-6 py-3 resize-none outline-none text-sm text-white placeholder:text-neutral-500"
              rows={1}
            />
            
            {/* Кнопки-иконки в той же строке */}
            <div className="flex items-center gap-2 px-6 py-3">
              <motion.button 
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="p-2 hover:bg-neutral-700/80 rounded-lg transition-colors"
              >
                <Smile className="w-4 h-4 text-neutral-400" />
              </motion.button>
            </div>
          </div>
        </div>
        
        {/* Send Button */}
        <motion.button
          whileHover={{ scale: 1.05, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSend}
          className="relative h-14 w-14 rounded-full bg-linear-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 transition-all shadow-xl shadow-orange-500/30 hover:shadow-orange-500/50 flex items-center justify-center group overflow-hidden"
        >
          <Send className="w-5 h-5 text-white relative z-10" />
        </motion.button>
      </div>
    </div>
  );
}