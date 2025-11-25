import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

interface SplashScreenProps {
  onEnter: () => void;
}

export function SplashScreen({ onEnter }: SplashScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-linear-to-br from-neutral-950 via-neutral-900 to-neutral-950 cursor-pointer"
      onClick={onEnter}
    >
      {/* Animated background orbs */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500/20 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.2, 0.3, 0.2],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.2, 0.3, 0.2],
        }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500/10 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.5, 1],
          rotate: [0, 180, 360],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "linear"
        }}
      />

      {/* Floating particles */}
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-orange-400/40 rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [0, 1, 0],
            scale: [0, 1, 0],
          }}
          transition={{
            duration: 3 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2,
            ease: "easeInOut"
          }}
        />
      ))}

      {/* Main content container */}
      <div className="relative z-10 text-center px-8 flex flex-col items-center justify-between h-full py-20">
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Logo container with glass effect */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="relative mb-12"
          >
            {/* Glow effect behind logo */}
            <motion.div
              className="absolute inset-0 bg-linear-to-r from-orange-500/30 to-orange-600/30 blur-3xl"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            
            {/* Logo text */}
            <div className="relative flex items-center justify-center gap-0">
              {/* AGENT text with glitch effect */}
              <motion.div
                className="relative"
                animate={{
                  textShadow: [
                    "0 0 20px rgba(255, 255, 255, 0.3)",
                    "0 0 30px rgba(255, 255, 255, 0.5)",
                    "0 0 20px rgba(255, 255, 255, 0.3)",
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                <span className="text-6xl md:text-8xl text-white tracking-tight" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 900 }}>
                  AGENT
                </span>
              </motion.div>
              
              {/* SPHERE text with gradient */}
              <motion.div
                className="relative"
                initial={{ x: -20, opacity: 0 }}
                animate={{ 
                  x: 0, 
                  opacity: 1,
                }}
                transition={{ duration: 0.8, delay: 0.3 }}
              >
                <motion.span
                  className="text-6xl md:text-8xl bg-linear-to-r from-orange-500 via-orange-400 to-orange-600 bg-clip-text text-transparent tracking-tight"
                  style={{ fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 900 }}
                  animate={{
                    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "linear"
                  }}
                >
                  SPHERE
                </motion.span>
              </motion.div>
            </div>
          </motion.div>

          {/* Tagline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="text-neutral-400 text-lg md:text-xl tracking-wide ml-8"
            style={{ marginTop: '-20px' }}
          >
            Dive in and feel the difference
          </motion.p>
        </div>

        {/* Tap to join button - moved to bottom */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="text-neutral-400 flex items-center gap-3 group"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="relative z-10 group-hover:text-orange-400 transition-colors">Tap to join</span>
          <motion.div
            animate={{
              x: [0, 5, 0],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          >
            <ArrowRight className="w-5 h-5 relative z-10 text-orange-400" />
          </motion.div>
        </motion.button>
      </div>

      {/* Mesh gradient overlay */}
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{
        backgroundImage: `
          radial-gradient(at 20% 30%, rgba(251, 146, 60, 0.15) 0px, transparent 50%),
          radial-gradient(at 80% 70%, rgba(168, 85, 247, 0.15) 0px, transparent 50%),
          radial-gradient(at 40% 80%, rgba(251, 146, 60, 0.1) 0px, transparent 50%)
        `,
      }} />
    </motion.div>
  );
}