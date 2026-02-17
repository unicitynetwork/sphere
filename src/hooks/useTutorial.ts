import { useState, useCallback, useEffect, useMemo } from 'react';
import { STORAGE_KEYS } from '../config/storageKeys';

export interface TutorialStep {
  target: string;
  title: string;
  description: string;
  /** data-tutorial selector to click before showing this step (e.g. switch tab) */
  trigger?: string;
}

const DESKTOP_STEPS: TutorialStep[] = [
  {
    target: 'header',
    title: 'Navigation',
    description:
      'Use the header to navigate between pages, toggle the theme, and access links',
  },
  {
    target: 'wallet',
    title: 'Wallet',
    description:
      'Here you can create a new or import an existing wallet and manage your assets',
  },
  {
    target: 'chat',
    title: 'Main Area',
    description:
      'Here the main interaction with the selected agent will happen',
  },
];

const MOBILE_STEPS: TutorialStep[] = [
  {
    target: 'header',
    title: 'Navigation',
    description:
      'Use the header to navigate between pages, toggle the theme, and access links',
  },
  {
    target: 'mobile-tabs',
    title: 'Switch Panels',
    description:
      'Use these tabs to switch between agents and your wallet',
  },
  {
    target: 'mobile-chat',
    title: 'Main Area',
    description:
      'Here the main interaction with the selected agent will happen',
  },
  {
    target: 'mobile-wallet',
    title: 'Wallet',
    description:
      'Here you can create a new or import an existing wallet and manage your assets',
    trigger: 'mobile-wallet-tab',
  },
];

function getSteps() {
  return window.innerWidth >= 1024 ? DESKTOP_STEPS : MOBILE_STEPS;
}

export function useTutorial() {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const steps = useMemo(getSteps, []);

  // Check on mount whether tutorial should show
  useEffect(() => {
    const completed =
      localStorage.getItem(STORAGE_KEYS.TUTORIAL_COMPLETED) === 'true';
    if (!completed) {
      setIsActive(true);
    }
  }, []);

  // Dismiss on resize across the breakpoint (targets change)
  useEffect(() => {
    const handleResize = () => {
      const newSteps = getSteps();
      if (newSteps !== steps && isActive) {
        setIsActive(false);
        // Don't persist — let user see it again at the correct layout
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive, steps]);

  const currentStep = steps[currentStepIndex];
  const isLastStep = currentStepIndex === steps.length - 1;

  const dismiss = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(STORAGE_KEYS.TUTORIAL_COMPLETED, 'true');
  }, []);

  const next = useCallback(() => {
    if (isLastStep) {
      dismiss();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  }, [isLastStep, dismiss]);

  return {
    isActive,
    currentStep,
    currentStepIndex,
    totalSteps: steps.length,
    isLastStep,
    next,
    dismiss,
  };
}
