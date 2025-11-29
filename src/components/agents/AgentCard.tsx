import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import type { IAgent } from '../../types';

export function AgentCard({ id, name, Icon: Icon, category, color, isSelected }: IAgent) {
  return (
    <Link to={`/agents/${id}`}>
      <motion.div
        whileHover={{ scale: 1.05, y: -8 }}
        whileTap={{ scale: 0.95 }}
        transition={{duration: 0.05}}
        className={`relative rounded-2xl p-6 h-[180px] flex flex-col items-center justify-center gap-4 transition-all duration-150 overflow-hidden group cursor-pointer ${
          isSelected ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-neutral-950' : ''
        }`}
      >
      {/* Animated Gradient Background */}
      <div className={`absolute inset-0 bg-linear-to-br ${color} opacity-90 group-hover:opacity-100 transition-all duration-200`} />
      
      {/* Animated mesh gradient overlay */}
      <div className="absolute inset-0 opacity-30 group-hover:opacity-50 transition-opacity duration-500"
        style={{
          backgroundImage: `radial-gradient(at 27% 37%, rgba(255, 255, 255, 0.1) 0px, transparent 50%),
                           radial-gradient(at 97% 21%, rgba(255, 255, 255, 0.1) 0px, transparent 50%),
                           radial-gradient(at 52% 99%, rgba(255, 255, 255, 0.1) 0px, transparent 50%),
                           radial-gradient(at 10% 29%, rgba(255, 255, 255, 0.1) 0px, transparent 50%)`
        }}
      />
      
      {/* Shine Effect */}
      <motion.div 
        className="absolute inset-0 bg-linear-to-tr from-transparent via-white/30 to-transparent"
        initial={{ x: '-100%', opacity: 0 }}
        whileHover={{ x: '100%', opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      />
      
      {/* Glow Effect */}
      <div className={`absolute -inset-1 bg-linear-to-br ${color} blur-2xl opacity-0 group-hover:opacity-70 transition-all duration-300`} />
      
      {/* Glass card effect on hover */}
      <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 backdrop-blur-0 group-hover:backdrop-blur-sm transition-all duration-300 rounded-2xl" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-4">
        {/* Icon Container with decorative rings */}
        <div className="relative">
          {/* Outer ring */}
          <div className="absolute -inset-2 rounded-2xl bg-white/20 blur-sm group-hover:bg-white/30 transition-all duration-300" />
          
          {/* Icon background */}
          <div className="relative w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/40 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-2xl">
            <Icon className="w-8 h-8 text-white drop-shadow-2xl" />
          </div>

          {/* Decorative dots */}
          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-white/60 group-hover:scale-150 transition-transform duration-300" />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-white/40 group-hover:scale-150 transition-transform duration-300" />
        </div>
        
        <div className="text-center">
          <div className="text-white drop-shadow-lg mb-1.5 group-hover:scale-105 transition-transform duration-300">{name}</div>
          <div className="text-xs text-white/90 drop-shadow px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20">
            {category}
          </div>
        </div>
      </div>

      {/* Corner Accents */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-bl-full group-hover:w-28 group-hover:h-28 transition-all duration-300" />
      <div className="absolute bottom-0 left-0 w-20 h-20 bg-black/10 rounded-tr-full group-hover:w-24 group-hover:h-24 transition-all duration-300" />

        {/* Selected Indicator */}
        {isSelected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-4 right-4 w-3 h-3 rounded-full bg-white shadow-lg z-20"
          >
            <div className="absolute inset-0 rounded-full bg-white animate-ping" />
          </motion.div>
        )}
      </motion.div>
    </Link>
  );
}