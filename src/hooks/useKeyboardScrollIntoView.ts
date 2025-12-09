import { type RefObject } from 'react';

/**
 * Hook to scroll an input element into view when mobile keyboard opens.
 *
 * NOTE: Disabled because with interactive-widget=resizes-content in viewport meta,
 * the browser handles this automatically. Manual scrollIntoView was causing
 * scroll position issues when keyboard closes.
 *
 * @param _inputRef - Reference to the input/textarea element (unused)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useKeyboardScrollIntoView(_inputRef: RefObject<HTMLElement | null>) {
  // No-op: Browser handles this automatically with interactive-widget=resizes-content
}
