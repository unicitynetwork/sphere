import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setMentionClickHandler } from '../utils/mentionHandler';

/**
 * Hook that enables @mention click navigation to DM chat.
 * When a user clicks on @username in a message, they will be navigated
 * to the chat agent with that user's nametag.
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   useMentionNavigation();
 *   // ... rest of component
 * }
 * ```
 */
export function useMentionNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleMentionClick = (username: string) => {
      // Ensure username has @ prefix for nametag format
      const nametag = username.startsWith('@') ? username : `@${username}`;
      navigate(`/agents/chat?nametag=${encodeURIComponent(nametag)}`);
    };

    setMentionClickHandler(handleMentionClick);

    return () => {
      setMentionClickHandler(null);
    };
  }, [navigate]);
}
