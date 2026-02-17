import { motion } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';

interface DesktopIconProps {
  agent: AgentConfig;
  isOpen?: boolean;
  onClick: () => void;
}

export function DesktopIcon({ agent, isOpen, onClick }: DesktopIconProps) {
  const { Icon, name, color } = agent;

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.08, y: -4 }}
      whileTap={{ scale: 0.92 }}
      transition={{ duration: 0.05 }}
      className="flex flex-col items-center gap-2 p-3 rounded-2xl group cursor-pointer relative"
    >
      {/* Icon container with gradient */}
      <div className="relative">
        {/* Glow on hover */}
        <div className={`absolute -inset-1 bg-linear-to-br ${color} blur-xl opacity-0 group-hover:opacity-50 transition-all duration-300`} />

        <div className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-linear-to-br ${color} flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-200 overflow-hidden`}>
          {/* Mesh overlay */}
          <div
            className="absolute inset-0 opacity-30 group-hover:opacity-50 transition-opacity duration-500"
            style={{
              backgroundImage: `radial-gradient(at 27% 37%, rgba(255,255,255,0.15) 0px, transparent 50%),
                               radial-gradient(at 97% 21%, rgba(255,255,255,0.1) 0px, transparent 50%)`,
            }}
          />
          {/* Corner accent */}
          <div className="absolute top-0 right-0 w-8 h-8 bg-white/10 rounded-bl-full group-hover:w-10 group-hover:h-10 transition-all duration-300" />

          <Icon className="w-7 h-7 sm:w-8 sm:h-8 text-white drop-shadow-lg relative z-10" />
        </div>

        {/* Open indicator dot */}
        {isOpen && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-orange-500 shadow-sm" />
        )}
      </div>

      {/* Label */}
      <span className="text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors truncate max-w-20 sm:max-w-24 text-center leading-tight">
        {name}
      </span>
    </motion.button>
  );
}
