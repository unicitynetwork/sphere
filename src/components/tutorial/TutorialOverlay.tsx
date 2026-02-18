import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TutorialStep } from '../../hooks/useTutorial';

interface TutorialOverlayProps {
  isActive: boolean;
  currentStep: TutorialStep;
  currentStepIndex: number;
  totalSteps: number;
  isLastStep: boolean;
  onNext: () => void;
  onDismiss: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 12;

export function TutorialOverlay({
  isActive,
  currentStep,
  currentStepIndex,
  totalSteps,
  isLastStep,
  onNext,
  onDismiss,
}: TutorialOverlayProps) {
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  const measureTarget = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(
      `[data-tutorial="${currentStep.target}"]`,
    );
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
      });
    }
    setIsMobile(window.innerWidth < 1024);
  }, [currentStep]);

  // Fire trigger (e.g. click wallet tab) then measure with retry
  useEffect(() => {
    if (!isActive) return;

    let timeout: ReturnType<typeof setTimeout>;

    if (currentStep.trigger) {
      // If the target is already visible, skip the trigger (avoids toggle issues)
      const existingEl = document.querySelector(
        `[data-tutorial="${currentStep.target}"]`,
      );
      if (existingEl) {
        const existingRect = existingEl.getBoundingClientRect();
        if (existingRect.width > 0 && existingRect.height > 0) {
          measureTarget();
          window.addEventListener('resize', measureTarget);
          return () => window.removeEventListener('resize', measureTarget);
        }
      }

      // Target not visible — fire trigger and retry measurement
      const triggerEl = document.querySelector<HTMLElement>(
        `[data-tutorial="${currentStep.trigger}"]`,
      );
      triggerEl?.click();

      // Retry measurement until element is found with non-zero dimensions
      let retries = 0;
      const tryMeasure = () => {
        const el = document.querySelector(
          `[data-tutorial="${currentStep.target}"]`,
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            measureTarget();
            return;
          }
        }
        if (retries < 10) {
          retries++;
          timeout = setTimeout(tryMeasure, 200);
        }
      };
      timeout = setTimeout(tryMeasure, 500);
    } else {
      const raf = requestAnimationFrame(() => measureTarget());
      return () => cancelAnimationFrame(raf);
    }

    window.addEventListener('resize', measureTarget);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', measureTarget);
    };
  }, [isActive, currentStep, measureTarget]);

  // Lock body scroll while active
  useEffect(() => {
    if (isActive) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isActive]);

  if (!isActive || !targetRect) return null;

  // Tooltip positioning
  const tooltipGap = 16;

  // On mobile: fixed at bottom center
  // On desktop: relative to the target element
  const tooltipStyle: React.CSSProperties = isMobile
    ? {
        bottom: tooltipGap,
        left: tooltipGap,
        right: tooltipGap,
      }
    : (() => {
        const tooltipBelow = targetRect.top + targetRect.height + tooltipGap;
        const fitsBelow = tooltipBelow < window.innerHeight - 200;
        const tooltipMaxW = Math.min(400, window.innerWidth - 32);
        // Clamp left so tooltip doesn't overflow the right edge
        const idealLeft = targetRect.left;
        const clampedLeft = Math.min(
          Math.max(16, idealLeft),
          window.innerWidth - tooltipMaxW - 16,
        );
        return {
          top: fitsBelow ? tooltipBelow : targetRect.top - tooltipGap,
          left: clampedLeft,
          maxWidth: tooltipMaxW,
          transformOrigin: fitsBelow ? 'top' : 'bottom',
          ...(fitsBelow ? {} : { transform: 'translateY(-100%)' }),
        };
      })();

  const fitsBelow = !isMobile
    ? targetRect.top + targetRect.height + tooltipGap < window.innerHeight - 200
    : true;

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          key="tutorial-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-200"
        >
          {/* Click-blocking background (transparent) */}
          <div className="absolute inset-0" onClick={onDismiss} />

          {/* Spotlight — sits over the target with a massive box-shadow to dim everything else */}
          <motion.div
            className="absolute rounded-2xl pointer-events-none border-2 border-orange-500/50"
            style={{
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.85)',
            }}
            initial={false}
            animate={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          />

          {/* Tooltip card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStepIndex}
              initial={{ opacity: 0, y: isMobile ? 20 : fitsBelow ? 10 : -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: isMobile ? 20 : fitsBelow ? -10 : 10 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className={isMobile ? 'fixed' : 'absolute'}
              style={tooltipStyle}
            >
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700/50 rounded-2xl p-5 shadow-2xl">
                {/* Step indicator dots */}
                <div className="flex items-center gap-1.5 mb-3">
                  {Array.from({ length: totalSteps }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        i === currentStepIndex
                          ? 'w-6 bg-orange-500'
                          : i < currentStepIndex
                            ? 'w-1.5 bg-orange-500/50'
                            : 'w-1.5 bg-neutral-300 dark:bg-neutral-600'
                      }`}
                    />
                  ))}
                </div>

                {/* Title */}
                <h3 className="text-base font-semibold text-neutral-900 dark:text-white mb-1">
                  {currentStep.title}
                </h3>

                {/* Description */}
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4 leading-relaxed">
                  {currentStep.description}
                </p>

                {/* Buttons */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={onDismiss}
                    className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                  >
                    Skip tutorial
                  </button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onNext}
                    className="px-4 py-2 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm font-medium shadow-lg shadow-orange-500/25 hover:from-orange-400 hover:to-orange-500 transition-all"
                  >
                    {isLastStep ? 'Got it!' : 'Next'}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
