import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { getMentionClickHandler } from './mentionHandler';

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

// Math block component for LaTeX formulas using KaTeX
function MathBlock({
  latex,
  displayMode,
  keyPrefix
}: {
  latex: string;
  displayMode: boolean;
  keyPrefix: string
}) {
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string>('');

  React.useEffect(() => {
    try {
      import('katex').then((katex) => {
        const rendered = katex.default.renderToString(latex, {
          displayMode,
          throwOnError: false,
          errorColor: '#ef4444',
          strict: false,
          trust: false,
        });
        setHtml(rendered);
        setError(null);
      }).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load KaTeX');
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render LaTeX');
    }
  }, [latex, displayMode]);

  if (error) {
    return (
      <div
        key={keyPrefix}
        className={`my-2 p-3 rounded-lg border-2 border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-900/20 ${
          displayMode ? 'block' : 'inline-block'
        }`}
      >
        <div className="flex items-start gap-2 text-sm">
          <span className="text-red-600 dark:text-red-400 font-mono">⚠</span>
          <div className="flex-1">
            <div className="text-red-700 dark:text-red-300 font-semibold mb-1">
              LaTeX Error
            </div>
            <pre className="text-xs text-neutral-600 dark:text-neutral-400 font-mono overflow-x-auto">
              {latex}
            </pre>
            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      key={keyPrefix}
      className={`my-2 ${displayMode ? 'text-center overflow-x-auto' : 'inline'}`}
      dangerouslySetInnerHTML={{ __html: html }}
      role="math"
      aria-label={`Math formula: ${latex}`}
    />
  );
}

// Helper to replace math placeholders with MathBlock components
function replaceMathPlaceholders(
  text: string,
  mathBlocks: string[],
  keyPrefix: string,
  startKey: number
): React.ReactNode[] {
  const mathPlaceholder = '\u0000MATH';
  const parts: React.ReactNode[] = [];
  const pattern = new RegExp(`${mathPlaceholder}(\\d+)\u0000`, 'g');

  let lastIndex = 0;
  let match;
  let key = startKey;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const mathIndex = parseInt(match[1], 10);
    parts.push(
      <MathBlock
        key={`${keyPrefix}-math-${key++}`}
        latex={mathBlocks[mathIndex]}
        displayMode={false}
        keyPrefix={`math-inline-${key}`}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}


// Parse inline markdown and HTML (bold, italic, code, br, links, images, plain URLs, @mentions)
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  // FIRST PASS: Handle escape sequences (e.g., \* should become just *)
  const unescapedText = text.replace(/\\([*_`[\]()#+-.|!\\])/g, '$1');

  // SECOND PASS: Extract inline math and replace with safe tokens that won't be matched by markdown regex
  const mathBlocks: string[] = [];
  const mathPlaceholder = '\u0000MATH';  // Unique placeholder that markdown won't match

  const processedText = unescapedText.replace(
    /(?<!\\)((?:\\\\)*)\\\((.+?)\\\)/g,
    (match, backslashes, latex) => {
      if (backslashes && backslashes.length % 2 === 1) {
        // Escaped, remove one backslash
        return match.slice(1);
      }
      // Store math and return placeholder
      const index = mathBlocks.push(latex) - 1;
      return `${mathPlaceholder}${index}\u0000`;
    }
  );

  const parts: React.ReactNode[] = [];
  let key = 0;

  // THIRD PASS: Process markdown - math placeholders won't be captured by markdown patterns
  // Added @mention pattern at the end: @username (alphanumeric, underscore, hyphen)
  // Note: hyphen must be at start or end of character class, or escaped
  const regex = /(\*\*(.+?)\*\*|\*([^\s*](?:[^*]*[^\s*])?)\*|_([^_]+?)_|`([^`]+?)`|<br\s*\/?>|<b>(.+?)<\/b>|<strong>(.+?)<\/strong>|<i>(.+?)<\/i>|<em>(.+?)<\/em>|<code>(.+?)<\/code>|<a\s+href=["']([^"']+)["']>(.+?)<\/a>|\[([^\]]+)\]\(((?:[^\s()]|\([^\s)]*\))+)(?:\s+"([^"]+)")?\)|!\[([^\]]*)\]\(((?:[^()]|\([^)]*\))+)\)|(https?:\/\/[^\s<>[\]()]+[^\s<>[\]().,;:!?'"])|(@[\w-]+))/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(processedText)) !== null) {
    // Process text before match (may contain math placeholders)
    if (match.index > lastIndex) {
      const textBefore = processedText.slice(lastIndex, match.index);
      parts.push(...replaceMathPlaceholders(textBefore, mathBlocks, keyPrefix, key));
      key += mathBlocks.length;
    }

    if (match[2]) {
      // **bold** - just render the text content (which may include math placeholders)
      const content = replaceMathPlaceholders(match[2], mathBlocks, `${keyPrefix}-bold`, key);
      parts.push(<strong key={`${keyPrefix}-strong-${key++}`}>{content}</strong>);
    } else if (match[3]) {
      // *italic*
      const content = replaceMathPlaceholders(match[3], mathBlocks, `${keyPrefix}-italic`, key);
      parts.push(<em key={`${keyPrefix}-em-${key++}`}>{content}</em>);
    } else if (match[4]) {
      // _italic_
      const content = replaceMathPlaceholders(match[4], mathBlocks, `${keyPrefix}-italic2`, key);
      parts.push(<em key={`${keyPrefix}-em2-${key++}`}>{content}</em>);
    } else if (match[5]) {
      // `code` - don't process math inside code blocks
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
      const content = replaceMathPlaceholders(match[6], mathBlocks, `${keyPrefix}-b`, key);
      parts.push(<strong key={`${keyPrefix}-b-${key++}`}>{content}</strong>);
    } else if (match[7]) {
      // <strong>text</strong>
      const content = replaceMathPlaceholders(match[7], mathBlocks, `${keyPrefix}-strong`, key);
      parts.push(<strong key={`${keyPrefix}-strong2-${key++}`}>{content}</strong>);
    } else if (match[8]) {
      // <i>text</i>
      const content = replaceMathPlaceholders(match[8], mathBlocks, `${keyPrefix}-i`, key);
      parts.push(<em key={`${keyPrefix}-i-${key++}`}>{content}</em>);
    } else if (match[9]) {
      // <em>text</em>
      const content = replaceMathPlaceholders(match[9], mathBlocks, `${keyPrefix}-em`, key);
      parts.push(<em key={`${keyPrefix}-em3-${key++}`}>{content}</em>);
    } else if (match[10]) {
      // <code>text</code> - don't process math inside code blocks
      parts.push(
        <code key={`${keyPrefix}-code2-${key++}`} className="bg-neutral-200 dark:bg-neutral-700/50 text-neutral-900 dark:text-neutral-200 px-1.5 py-0.5 rounded text-sm font-mono">
          {match[10]}
        </code>
      );
    } else if (match[11] && match[12]) {
      // <a href="url">text</a>
      const content = replaceMathPlaceholders(match[12], mathBlocks, `${keyPrefix}-a`, key);
      parts.push(
        <a key={`${keyPrefix}-a-${key++}`} href={match[11]} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline">
          {content}
        </a>
      );
    } else if (match[13] && match[14]) {
      // [text](url) or [text](url "tooltip") markdown link
      const content = replaceMathPlaceholders(match[13], mathBlocks, `${keyPrefix}-link`, key);
      const tooltip = match[15]; // Optional tooltip
      parts.push(
        <a
          key={`${keyPrefix}-link-${key++}`}
          href={match[14]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline"
          title={tooltip || undefined}
        >
          {content}
        </a>
      );
    } else if (match[17]) {
      // ![alt](url) markdown image (supports base64 data URLs)
      const alt = match[16] || 'image';
      const src = match[17];
      parts.push(
        <img
          key={`${keyPrefix}-img-${key++}`}
          src={src}
          alt={alt}
          className="max-w-full h-auto rounded-lg my-2 border border-neutral-300 dark:border-neutral-700/50"
          loading="lazy"
        />
      );
    } else if (match[18]) {
      // Plain URL (https://... or http://...)
      const url = match[18];
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
    } else if (match[19]) {
      // @mention (e.g., @username)
      const mention = match[19];
      const username = mention.slice(1); // Remove @ prefix
      parts.push(
        <span
          key={`${keyPrefix}-mention-${key++}`}
          className="text-white font-bold cursor-pointer hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            const handler = getMentionClickHandler();
            if (handler) {
              handler(username);
            }
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const handler = getMentionClickHandler();
              if (handler) {
                handler(username);
              }
            }
          }}
        >
          {mention}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Process remaining text (may contain math placeholders)
  if (lastIndex < processedText.length) {
    const remaining = processedText.slice(lastIndex);
    parts.push(...replaceMathPlaceholders(remaining, mathBlocks, keyPrefix, key));
  }

  return parts.length > 0 ? parts : [text];
}

// Helper function to split table row by | while respecting escaped | and links
function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let escaped = false;
  let bracketDepth = 0;  // Track depth of [ ] for nested brackets
  let inLinkParen = false;  // Track if we're inside (...) part of a link

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (escaped) {
      currentCell += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      currentCell += char;
      continue;
    }

    if (char === '[') {
      bracketDepth++;
      currentCell += char;
      continue;
    }

    if (char === ']' && bracketDepth > 0) {
      bracketDepth--;
      currentCell += char;
      if (bracketDepth === 0 && i + 1 < line.length && line[i + 1] === '(') {
        inLinkParen = true;
      }
      continue;
    }

    if (char === '"' && (inLinkParen || inQuotes)) {
      inQuotes = !inQuotes;
      currentCell += char;
      continue;
    }

    if (char === ')' && inLinkParen && !inQuotes) {
      inLinkParen = false;
      currentCell += char;
      continue;
    }

    // Only split on | when not inside brackets, link parens, or quotes
    if (char === '|' && !inQuotes && bracketDepth === 0 && !inLinkParen) {
      cells.push(currentCell);
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  // Push the last cell
  if (currentCell || line.endsWith('|')) {
    cells.push(currentCell);
  }

  // Remove empty first/last from split (table format is |cell1|cell2|)
  return cells.slice(1, -1).map(cell => cell.trim());
}

// Parse markdown table
function parseTable(lines: string[], keyPrefix: string): React.ReactNode {
  const rows = lines
    .filter(line => !line.match(/^\|[\s-:|]+\|$/)) // Skip separator rows
    .map(line => splitTableRow(line));

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

    // Check for display math block start \[
    if (line.includes('\\[')) {
      const startMatch = line.match(/\\\\?\[/);

      if (startMatch && startMatch[0] === '\\[') {
        // Not escaped, process as math block
        const beforeMath = line.slice(0, startMatch.index);
        const afterStart = line.slice(startMatch.index! + 2);

        // Add any content before \[
        if (beforeMath.trim()) {
          parts.push(
            <p key={`p-${key++}`} className="leading-relaxed">
              {parseInline(beforeMath, `line-${key}`)}
            </p>
          );
        }

        // Collect math content until \]
        const mathLines: string[] = [];
        let mathLine = afterStart;
        let foundEnd = false;

        while (i < lines.length) {
          const endMatch = mathLine.match(/\\\\?\]/);

          if (endMatch && endMatch[0] === '\\]') {
            // Found unescaped \]
            mathLines.push(mathLine.slice(0, endMatch.index));
            const afterMath = mathLine.slice(endMatch.index! + 2);
            foundEnd = true;

            // Render the math block
            const latex = mathLines.join('\n').trim();
            parts.push(
              <MathBlock
                key={`math-${key++}`}
                latex={latex}
                displayMode={true}
                keyPrefix={`mathblock-${key}`}
              />
            );

            // Process remaining content on this line
            if (afterMath.trim()) {
              parts.push(
                <p key={`p-${key++}`} className="leading-relaxed">
                  {parseInline(afterMath, `line-${key}`)}
                </p>
              );
            }

            i++;
            break;
          } else {
            // No end found on this line
            mathLines.push(mathLine);
            i++;
            if (i < lines.length) {
              mathLine = lines[i];
            } else {
              foundEnd = false;
              break;
            }
          }
        }

        if (!foundEnd) {
          // No closing \], treat as regular text
          const fullText = '\\[' + mathLines.join('\n');
          parts.push(
            <p key={`p-${key++}`} className="leading-relaxed">
              {parseInline(fullText, `line-${key}`)}
            </p>
          );
        }

        continue;
      } else if (startMatch && startMatch[0] === '\\\\[') {
        // Escaped \[, remove one backslash
        const unescaped = line.replace('\\\\[', '\\[');
        parts.push(
          <p key={`p-${key++}`} className="leading-relaxed">
            {parseInline(unescaped, `line-${key}`)}
          </p>
        );
        i++;
        continue;
      }
    }

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

    // Check for horizontal rule (---, ***, or ___)
    if (line.trim().match(/^([-*_])\1{2,}$/)) {
      parts.push(
        <hr
          key={`hr-${key++}`}
          className="my-4 border-t border-neutral-300 dark:border-neutral-700"
        />
      );
      i++;
      continue;
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
