import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'How can I help you?',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
const messagesContainerRef = useRef<HTMLDivElement>(null);

const scrollToBottom = () => {
  const el = messagesContainerRef.current;
  if (!el) return;
  el.scrollTo({
    top: el.scrollHeight,
    behavior: 'smooth',
  });
};

useEffect(() => {
  scrollToBottom();
}, [messages]);

  // Mock AI response generator
  // TO INTEGRATE WITH REAL AI API (like OpenAI):
  // 1. Replace this function with an actual API call
  // 2. Use fetch or axios to call your AI endpoint
  // 3. Handle streaming responses if needed
  // 4. Add error handling for API failures
  const generateMockResponse = (): string => {
    const responses = [
      "How can I help you?",
      "Yeah sure! There is a delivery service that can deliver it - it will cost you 40 USDU.",
      "Done! Will keep you posted! I may need to share additional details.\n\nBy the way, your son is asking for 10 dollars - doesn't give a reason why.",
      "ok, give me 5 mins. Checking what is available in the neighborhood.",
    ];
    
    // Rotate through responses
    const responseIndex = messages.filter(m => m.role === 'assistant').length % responses.length;
    return responses[responseIndex];
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simulate API delay
    // TO INTEGRATE WITH REAL AI API:
    // Replace this setTimeout with actual API call like:
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${YOUR_API_KEY}`
    //   },
    //   body: JSON.stringify({
    //     model: 'gpt-4',
    //     messages: messages.map(m => ({ role: m.role, content: m.content }))
    //   })
    // });
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: generateMockResponse(),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1000 + Math.random() * 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col relative">
      {/* Background decorative elements */}
      <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="mb-6 p-6 rounded-2xl bg-linear-to-r from-neutral-900/80 to-neutral-800/50 backdrop-blur-xl border border-neutral-800/50 shadow-2xl relative overflow-hidden shrink-0">
        {/* Animated gradient orb */}
        <motion.div
          className="absolute -top-10 -right-10 w-32 h-32 bg-orange-500/20 rounded-full blur-2xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.3, 0.2],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        
        <div className="flex items-center gap-3 relative z-10">
          <div className="p-3 rounded-xl bg-linear-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/30">
            <Sparkles className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h2 className="text-2xl text-white">AI Assistant</h2>
            <p className="text-neutral-400">Powered by advanced AI technology</p>
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div ref={messagesContainerRef} className="flex flex-col h-[400px] overflow-y-auto mb-6 rounded-2xl bg-linear-to-br from-neutral-900/40 to-neutral-800/20 backdrop-blur-sm border border-neutral-800/50 p-6 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl p-4 ${
                  message.role === 'user'
                    ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20'
                    : 'bg-linear-to-br from-neutral-800/80 to-neutral-700/60 backdrop-blur-xl border border-neutral-700/50 text-neutral-200'
                }`}
              >
                {/* Role indicator */}
                <div className="flex items-center gap-2 mb-2">
                  {message.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-linear-to-br from-orange-500/30 to-orange-600/20 flex items-center justify-center">
                      <Sparkles className="w-3 h-3 text-orange-400" />
                    </div>
                  )}
                  <span className={`text-xs ${message.role === 'user' ? 'text-orange-100' : 'text-neutral-400'}`}>
                    {message.role === 'user' ? 'You' : 'AI Assistant'}
                  </span>
                  <span className={`text-xs ${message.role === 'user' ? 'text-orange-200/60' : 'text-neutral-500'}`}>
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                
                {/* Message content */}
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading indicator */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="bg-linear-to-br from-neutral-800/80 to-neutral-700/60 backdrop-blur-xl border border-neutral-700/50 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-linear-to-br from-orange-500/30 to-orange-600/20 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-orange-400" />
                </div>
                <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
                <span className="text-neutral-400">Thinking...</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input Area */}
      <div className="relative">
        {/* Glow effect */}
        <motion.div
          className="absolute -inset-1 bg-linear-to-r from-orange-500/20 to-orange-600/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100"
          animate={{
            opacity: [0, 0.3, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        
        <div className="relative flex gap-3 p-4 rounded-2xl bg-linear-to-br from-neutral-900/80 to-neutral-800/60 backdrop-blur-xl border border-neutral-800/50 shadow-2xl group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything..."
            className="flex-1 bg-transparent text-white placeholder-neutral-500 outline-none resize-none min-h-12 max-h-[200px]"
            rows={1}
            disabled={isLoading}
          />
          
          <motion.button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-6 py-3 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20 relative overflow-hidden"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {/* Button shine effect */}
            <motion.div
              className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent"
              animate={{
                x: ['-100%', '200%'],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                repeatDelay: 1,
                ease: "easeInOut"
              }}
            />
            
            <Send className="w-5 h-5 relative z-10" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}