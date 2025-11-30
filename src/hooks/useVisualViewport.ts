import { useEffect, useState, useCallback } from 'react';

interface ViewportState {
  height: number;
  offsetTop: number;
  isKeyboardOpen: boolean;
}

/**
 * Hook to track visual viewport changes (especially for mobile keyboard)
 * Uses the Visual Viewport API for accurate mobile viewport tracking
 * Similar approach to OpenAI ChatGPT mobile handling
 */
export function useVisualViewport() {
  const [viewport, setViewport] = useState<ViewportState>(() => ({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
    isKeyboardOpen: false,
  }));

  const updateViewport = useCallback(() => {
    if (typeof window === 'undefined') return;

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      const height = visualViewport.height;
      const offsetTop = visualViewport.offsetTop;
      const isKeyboardOpen = window.innerHeight - height > 150;

      setViewport({ height, offsetTop, isKeyboardOpen });

      // Set CSS custom property for use in styles
      document.documentElement.style.setProperty(
        '--visual-viewport-height',
        `${height}px`
      );
      document.documentElement.style.setProperty(
        '--viewport-offset-top',
        `${offsetTop}px`
      );
    } else {
      // Fallback for browsers without Visual Viewport API
      setViewport({
        height: window.innerHeight,
        offsetTop: 0,
        isKeyboardOpen: false,
      });
      document.documentElement.style.setProperty(
        '--visual-viewport-height',
        `${window.innerHeight}px`
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initial update
    updateViewport();

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener('resize', updateViewport);
      visualViewport.addEventListener('scroll', updateViewport);
    }

    // Also listen to window resize as fallback
    window.addEventListener('resize', updateViewport);

    return () => {
      if (visualViewport) {
        visualViewport.removeEventListener('resize', updateViewport);
        visualViewport.removeEventListener('scroll', updateViewport);
      }
      window.removeEventListener('resize', updateViewport);
    };
  }, [updateViewport]);

  return viewport;
}
