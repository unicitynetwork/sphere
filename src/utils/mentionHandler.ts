// Global handler for @mention clicks
// Separated from markdown.tsx to satisfy react-refresh/only-export-components rule

export type MentionClickHandler = (username: string) => void;

let globalMentionClickHandler: MentionClickHandler | null = null;

export function setMentionClickHandler(handler: MentionClickHandler | null) {
  globalMentionClickHandler = handler;
}

export function getMentionClickHandler(): MentionClickHandler | null {
  return globalMentionClickHandler;
}
