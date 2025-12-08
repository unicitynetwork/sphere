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
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-200 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700">
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
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
      <pre className="p-4 bg-neutral-100 dark:bg-neutral-900 overflow-x-auto">
        <code className="text-sm text-neutral-800 dark:text-neutral-200 font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

// Parse inline markdown and HTML (bold, italic, code, br, links, images, plain URLs)
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let key = 0;

  // Combined regex for markdown and HTML:
  // 1: **bold**, 2: *italic* (strict - no spaces after/before asterisks), 3: _italic_, 4: `code`
  // 5: <br> or <br/>, 6: <b>text</b>, 7: <strong>text</strong>
  // 8: <i>text</i>, 9: <em>text</em>, 10: <code>text</code>
  // 11: <a href="url">text</a>, 12: [text](url) markdown links
  // 15: ![alt](url) markdown images (including base64 data URLs)
  // 17: plain URLs (https://... or http://...)
  const regex = /(\*\*(.+?)\*\*|\*([^\s*](?:[^*]*[^\s*])?)\*|_([^_]+?)_|`([^`]+?)`|<br\s*\/?>|<b>(.+?)<\/b>|<strong>(.+?)<\/strong>|<i>(.+?)<\/i>|<em>(.+?)<\/em>|<code>(.+?)<\/code>|<a\s+href=["']([^"']+)["']>(.+?)<\/a>|\[([^\]]+)\]\(([^)]+)\)|!\[([^\]]*)\]\(([^)]+)\)|(https?:\/\/[^\s<>[\]()]+[^\s<>[\]().,;:!?'"]))/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(<strong key={`${keyPrefix}-strong-${key++}`}>{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      parts.push(<em key={`${keyPrefix}-em-${key++}`}>{match[3]}</em>);
    } else if (match[4]) {
      // _italic_
      parts.push(<em key={`${keyPrefix}-em2-${key++}`}>{match[4]}</em>);
    } else if (match[5]) {
      // `code`
      parts.push(
        <code key={`${keyPrefix}-code-${key++}`} className="bg-neutral-200 dark:bg-neutral-700/50 text-neutral-900 dark:text-neutral-200 px-1.5 py-0.5 rounded text-sm font-mono">
          {match[5]}
        </code>
      );
    } else if (match[0].toLowerCase().startsWith('<br')) {
      // <br> or <br/>
      parts.push(<br key={`${keyPrefix}-br-${key++}`} />);
    } else if (match[6]) {
      // <b>text</b>
      parts.push(<strong key={`${keyPrefix}-b-${key++}`}>{match[6]}</strong>);
    } else if (match[7]) {
      // <strong>text</strong>
      parts.push(<strong key={`${keyPrefix}-strong2-${key++}`}>{match[7]}</strong>);
    } else if (match[8]) {
      // <i>text</i>
      parts.push(<em key={`${keyPrefix}-i-${key++}`}>{match[8]}</em>);
    } else if (match[9]) {
      // <em>text</em>
      parts.push(<em key={`${keyPrefix}-em3-${key++}`}>{match[9]}</em>);
    } else if (match[10]) {
      // <code>text</code>
      parts.push(
        <code key={`${keyPrefix}-code2-${key++}`} className="bg-neutral-200 dark:bg-neutral-700/50 text-neutral-900 dark:text-neutral-200 px-1.5 py-0.5 rounded text-sm font-mono">
          {match[10]}
        </code>
      );
    } else if (match[11] && match[12]) {
      // <a href="url">text</a>
      parts.push(
        <a key={`${keyPrefix}-a-${key++}`} href={match[11]} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline">
          {match[12]}
        </a>
      );
    } else if (match[13] && match[14]) {
      // [text](url) markdown link
      parts.push(
        <a key={`${keyPrefix}-link-${key++}`} href={match[14]} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline">
          {match[13]}
        </a>
      );
    } else if (match[16]) {
      // ![alt](url) markdown image (supports base64 data URLs)
      const alt = match[15] || 'image';
      const src = match[16];
      parts.push(
        <img
          key={`${keyPrefix}-img-${key++}`}
          src={src}
          alt={alt}
          className="max-w-full h-auto rounded-lg my-2 border border-neutral-300 dark:border-neutral-700/50"
          loading="lazy"
        />
      );
    } else if (match[17]) {
      // Plain URL (https://... or http://...)
      const url = match[17];
      parts.push(
        <a
          key={`${keyPrefix}-url-${key++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline break-all"
        >
          {url}
        </a>
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
          <tr className="border-b border-neutral-300 dark:border-neutral-600">
            {header.map((cell, i) => (
              <th key={i} className="text-left p-2 font-semibold text-neutral-800 dark:text-neutral-200">
                {parseInline(cell, `${keyPrefix}-th-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-neutral-200 dark:border-neutral-700/50 hover:bg-neutral-100 dark:hover:bg-neutral-700/20">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="p-2 text-neutral-700 dark:text-neutral-300">
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
    1: 'text-2xl font-bold text-neutral-900 dark:text-white mt-4 mb-2',
    2: 'text-xl font-bold text-neutral-900 dark:text-white mt-3 mb-2',
    3: 'text-lg font-semibold text-neutral-800 dark:text-neutral-100 mt-3 mb-1',
    4: 'text-base font-semibold text-neutral-700 dark:text-neutral-200 mt-2 mb-1',
    5: 'text-sm font-semibold text-neutral-600 dark:text-neutral-300 mt-2 mb-1',
    6: 'text-sm font-medium text-neutral-500 dark:text-neutral-400 mt-2 mb-1',
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
// Supports: **bold**, *italic*, _italic_, `code`, ```code blocks```, # headers, tables,
// unordered lists (* or - followed by space), HTML tags: <br>, <b>, <strong>, <i>, <em>, <code>, <a href="">
// Links: [text](url), plain URLs (https://... http://...)
export function MarkdownContent({ text }: { text: string }) {
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

    // Check if this is the start of an unordered list (* or - followed by space)
    const listMatch = line.match(/^(\s*)([*-])\s+(.*)$/);
    if (listMatch) {
      const listItems: { content: string }[] = [];

      // Collect consecutive list items
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)([*-])\s+(.*)$/);
        if (itemMatch) {
          listItems.push({ content: itemMatch[3] });
          i++;
        } else {
          break;
        }
      }

      if (listItems.length > 0) {
        parts.push(
          <ul key={`ul-${key++}`} className="list-disc list-inside space-y-1 ml-1">
            {listItems.map((item, idx) => (
              <li key={idx} className="text-neutral-800 dark:text-neutral-200">
                {parseInline(item.content, `li-${key}-${idx}`)}
              </li>
            ))}
          </ul>
        );
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
