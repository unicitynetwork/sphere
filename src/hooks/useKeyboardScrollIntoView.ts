import { useEffect, useRef, type RefObject } from 'react';

/**
 * Hook to scroll an input element into view when mobile keyboard opens.
 * Uses Visual Viewport API to detect keyboard appearance instead of setTimeout.
 *
 * @param inputRef - Reference to the input/textarea element
 */
export function useKeyboardScrollIntoView(inputRef: RefObject<HTMLElement | null>) {
  const isFocused = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleFocus = () => {
      isFocused.current = true;
    };

    const handleBlur = () => {
      isFocused.current = false;
    };

    // When viewport resizes (keyboard opens/closes), scroll input into view
    const handleViewportResize = () => {
      // Only on mobile and when input is focused
      if (window.innerWidth >= 1024 || !isFocused.current) return;

      // Use requestAnimationFrame for smooth scrolling after layout
      requestAnimationFrame(() => {
        inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    };

    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);

    // Subscribe to Visual Viewport resize events
    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener('resize', handleViewportResize);
    }

    return () => {
      input.removeEventListener('focus', handleFocus);
      input.removeEventListener('blur', handleBlur);
      visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, [inputRef]);
}
