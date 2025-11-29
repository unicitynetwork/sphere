import { Bell, Settings, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

const agentMode = import.meta.env.VITE_AGENT_MODE;

export function Header() {
  return (
    <header className="border-b border-neutral-800/50 bg-neutral-900/80 backdrop-blur-2xl sticky top-0 z-50 overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute top-0 left-0 w-96 h-full bg-linear-to-r from-orange-500/10 to-transparent blur-3xl" />
      <div className="absolute top-0 right-0 w-96 h-full bg-linear-to-l from-purple-500/10 to-transparent blur-3xl" />
      
      {/* Animated gradient line on top */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-linear-to-r from-transparent via-orange-500 to-transparent opacity-50" />
      
      <div className="max-w-[1800px] mx-auto px-8 h-20 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-4">
          {/* Logo with enhanced effects */}
          <motion.div 
            whileHover={{ scale: 1.05, rotate: 5 }}
            className="relative"
          >
            {/* Glow effect */}
            <div className="absolute inset-0 bg-linear-to-br from-orange-500 to-orange-600 rounded-xl blur-xl opacity-50" />
            
            <div className="relative w-12 h-12 rounded-xl bg-linear-to-br from-orange-500 via-orange-600 to-red-600 flex items-center justify-center shadow-2xl border border-orange-400/30">
              {/* Shine overlay */}
              <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/30 to-white/0 rounded-xl" />
              
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="relative z-10 drop-shadow-lg"
              >
                <path
                  d="M12 2L2 7L12 12L22 7L12 2Z"
                  fill="white"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 17L12 22L22 17"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 12L12 17L22 12"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </motion.div>
          
          <div className="relative">
            <div className="flex items-center gap-2">
              <h1 className="text-xl text-white bg-clip-text">AgentSphere</h1>
              <Sparkles className="w-4 h-4 text-orange-500 animate-pulse" />
              {agentMode !== 'real' && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                  DEMO
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400">AI-Powered Agent Platform</p>
            
            {/* Decorative underline */}
            <div className="absolute -bottom-1 left-0 w-20 h-0.5 bg-linear-to-r from-orange-500 to-transparent rounded-full" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Notification Button */}
          <motion.button 
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{duration: 0.05}}
            className="relative p-3 hover:bg-neutral-800/80 rounded-xl transition-all group"
          >
            <Bell className="w-5 h-5 text-neutral-400 group-hover:text-orange-400 transition-colors" />
            
            {/* Notification badge */}
            <span className="absolute top-2 right-2 w-2 h-2 bg-orange-500 rounded-full">
              <span className="absolute inset-0 bg-orange-500 rounded-full animate-ping" />
            </span>
            
            {/* Glow on hover */}
            <div className="absolute inset-0 rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.button>
          
          {/* Settings Button */}
          <motion.button 
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{duration: 0.05}}
            className="relative p-3 hover:bg-neutral-800/80 rounded-xl transition-all group"
          >
            <Settings className="w-5 h-5 text-neutral-400 group-hover:text-orange-400 transition-colors" />
            <div className="absolute inset-0 rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.button>
        
        </div>
      </div>
      
      {/* Bottom gradient line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-neutral-700 to-transparent" />
    </header>
  );
}