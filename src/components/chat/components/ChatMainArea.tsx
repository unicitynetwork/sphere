// src/components/chat/components/ChatMainArea.tsx
import { motion } from 'framer-motion';
import { Users, Hash, ChevronDown } from 'lucide-react';
import type { ChatState } from '../../../hooks/useChatState';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

type MainAreaProps = Pick<ChatState, 'chatMode' | 'selectedUser' | 'messages' | 'onlineCount' | 'message' | 'setMessage' | 'handleSend'>;

export function ChatMainArea(props: MainAreaProps) {
  const { chatMode, selectedUser, messages, onlineCount } = props;
  
  const totalOnlineCount = onlineCount + 124;

  return (
    <div className="flex-1 flex flex-col relative z-10">
      {/* Chat Header */}
      <div className="h-20 border-b border-neutral-800/50 px-8 flex items-center justify-between bg-linear-to-br from-neutral-900/80 to-neutral-800/40 backdrop-blur-sm relative">
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-orange-500/5 rounded-tr-full" />
        
        <div className="flex items-center gap-4 relative z-10">
          {/* Header Content (Global vs DM) */}
          {chatMode === 'global' ? (
            <>
              <motion.div whileHover={{ rotate: 5, scale: 1.05 }} className="relative">
                <div className="absolute inset-0 bg-orange-500 rounded-xl blur-lg opacity-50" />
                <div className="relative w-12 h-12 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl">
                  <Hash className="w-6 h-6 text-white" />
                </div>
              </motion.div>
              <div>
                <h3 className="text-white">Global Channel</h3>
                <p className="text-sm text-emerald-400 flex items-center gap-2">
                  <Users className="w-3 h-3" />
                  {totalOnlineCount} members online
                </p>
              </div>
            </>
          ) : (
            <>
              <motion.div whileHover={{ scale: 1.05 }} className="relative">
                <div className="absolute inset-0 bg-orange-500 rounded-xl blur-lg opacity-50" />
                <div className="relative w-12 h-12 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl text-white">
                  {selectedUser?.avatar}
                </div>
              </motion.div>
              <div>
                <h3 className="text-white">{selectedUser?.name}</h3>
                <p className="text-sm text-emerald-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400">
                    <span className="absolute w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  </span>
                  {selectedUser?.status}
                </p>
              </div>
            </>
          )}
        </div>
        
        <motion.button 
          whileHover={{ scale: 1.05, rotate: 180 }}
          whileTap={{ scale: 0.95 }}
          className="p-2 hover:bg-neutral-800/80 rounded-xl transition-colors relative z-10 border border-transparent hover:border-neutral-700/50"
        >
          <ChevronDown className="w-5 h-5 text-neutral-400" />
        </motion.button>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Message Input */}
      <MessageInput 
        chatMode={chatMode} 
        selectedUser={selectedUser} 
        message={props.message} 
        setMessage={props.setMessage} 
        handleSend={props.handleSend} 
      />
    </div>
  );
}