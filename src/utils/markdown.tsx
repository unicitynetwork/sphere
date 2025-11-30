import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Code block component with copy button
function CodeBlock({ code, language, keyPrefix }: { code: string; language?: string; keyPrefix: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div key={keyPrefix} className="relative group my-3 rounded-xl overflow-hidden">
      {/* Header with language and copy button */}
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-800 border-b border-neutral-700">
        <span className="text-xs text-neutral-400 font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code content */}
      <pre className="p-4 bg-neutral-900 overflow-x-auto">
        <code className="text-sm text-neutral-200 font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

// Parse inline markdown (bold, italic, code)
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let key = 0;

  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      parts.push(<strong key={`${keyPrefix}-strong-${key++}`}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={`${keyPrefix}-em-${key++}`}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(<em key={`${keyPrefix}-em2-${key++}`}>{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={`${keyPrefix}-code-${key++}`} className="bg-neutral-700/50 px-1.5 py-0.5 rounded text-sm font-mono">
          {match[5]}
        </code>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// Parse markdown table
function parseTable(lines: string[], keyPrefix: string): React.ReactNode {
  const rows = lines
    .filter(line => !line.match(/^\|[\s-:|]+\|$/)) // Skip separator rows
    .map(line =>
      line
        .split('|')
        .slice(1, -1) // Remove empty first/last from split
        .map(cell => cell.trim())
    );

  if (rows.length === 0) return null;

  const [header, ...body] = rows;

  return (
    <div key={keyPrefix} className="overflow-x-auto my-2">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-neutral-600">
            {header.map((cell, i) => (
              <th key={i} className="text-left p-2 font-semibold text-neutral-200">
                {parseInline(cell, `${keyPrefix}-th-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-neutral-700/50 hover:bg-neutral-700/20">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="p-2 text-neutral-300">
                  {parseInline(cell, `${keyPrefix}-td-${rowIndex}-${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Parse header line (# ## ### etc.)
function parseHeader(line: string, keyPrefix: string): React.ReactNode {
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (!match) return null;

  const level = match[1].length;
  const content = match[2];

  const styles: Record<number, string> = {
    1: 'text-2xl font-bold text-white mt-4 mb-2',
    2: 'text-xl font-bold text-white mt-3 mb-2',
    3: 'text-lg font-semibold text-neutral-100 mt-3 mb-1',
    4: 'text-base font-semibold text-neutral-200 mt-2 mb-1',
    5: 'text-sm font-semibold text-neutral-300 mt-2 mb-1',
    6: 'text-sm font-medium text-neutral-400 mt-2 mb-1',
  };

  const inlineContent = parseInline(content, `${keyPrefix}-h`);

  switch (level) {
    case 1:
      return <h1 key={keyPrefix} className={styles[1]}>{inlineContent}</h1>;
    case 2:
      return <h2 key={keyPrefix} className={styles[2]}>{inlineContent}</h2>;
    case 3:
      return <h3 key={keyPrefix} className={styles[3]}>{inlineContent}</h3>;
    case 4:
      return <h4 key={keyPrefix} className={styles[4]}>{inlineContent}</h4>;
    case 5:
      return <h5 key={keyPrefix} className={styles[5]}>{inlineContent}</h5>;
    case 6:
      return <h6 key={keyPrefix} className={styles[6]}>{inlineContent}</h6>;
    default:
      return <p key={keyPrefix} className={styles[1]}>{inlineContent}</p>;
  }
}

// Simple markdown parser for chat messages
// Supports: **bold**, *italic*, _italic_, `code`, ```code blocks```, # headers, tables, and newlines
export function parseMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;

  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for code block start
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;

      // Collect lines until closing ```
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```

      const code = codeLines.join('\n');
      parts.push(<CodeBlock key={`code-${key++}`} code={code} language={language} keyPrefix={`codeblock-${key}`} />);
      continue;
    }

    // Check if this is a header
    if (line.trim().match(/^#{1,6}\s+/)) {
      const header = parseHeader(line.trim(), `header-${key++}`);
      if (header) {
        parts.push(header);
        i++;
        continue;
      }
    }

    // Check if this is the start of a table
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        parts.push(parseTable(tableLines, `table-${key++}`));
      }
      continue;
    }

    // Empty line - add spacing
    if (line.trim() === '') {
      parts.push(<div key={`space-${key++}`} className="h-2" />);
      i++;
      continue;
    }

    // Regular line
    parts.push(
      <p key={`p-${key++}`} className="leading-relaxed">
        {parseInline(line, `line-${key}`)}
      </p>
    );
    i++;
  }

  return <div className="space-y-1">{parts}</div>;
}
