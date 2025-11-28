import React from 'react';

// Simple markdown parser for chat messages
// Supports: **bold**, *italic*, _italic_, `code`, and newlines
export function parseMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;

  // Split by newlines first
  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      parts.push(<br key={`br-${key++}`} />);
    }

    // Regex to match **bold**, *italic*, _italic_, `code`
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(line)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }

      // Add formatted text
      if (match[2]) {
        // **bold**
        parts.push(<strong key={`strong-${key++}`}>{match[2]}</strong>);
      } else if (match[3]) {
        // *italic*
        parts.push(<em key={`em-${key++}`}>{match[3]}</em>);
      } else if (match[4]) {
        // _italic_
        parts.push(<em key={`em2-${key++}`}>{match[4]}</em>);
      } else if (match[5]) {
        // `code`
        parts.push(
          <code key={`code-${key++}`} className="bg-neutral-700/50 px-1.5 py-0.5 rounded text-sm">
            {match[5]}
          </code>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }
  });

  return <>{parts}</>;
}
