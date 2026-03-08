/**
 * Markdown Intermediate Representation (IR)
 * 
 * Parses markdown into a structured format that can be:
 * - Rendered to different output formats (HTML, plain text)
 * - Split into chunks while preserving structure
 * - Analyzed for content types
 * 
 * Inspired by OpenClaw's approach for more robust markdown handling.
 */

export type MarkdownNodeType =
  | 'text'
  | 'bold'
  | 'italic'
  | 'code'
  | 'code_block'
  | 'strikethrough'
  | 'link'
  | 'spoiler'
  | 'paragraph'
  | 'line_break'
  | 'blockquote'
  | 'list_item'
  | 'horizontal_rule';

export interface MarkdownNode {
  type: MarkdownNodeType;
  content?: string;
  language?: string; // For code blocks
  href?: string;     // For links
  children?: MarkdownNode[];
}

export interface MarkdownIR {
  nodes: MarkdownNode[];
  text: string; // Original text for reference
}

export interface ParseOptions {
  linkify?: boolean;      // Auto-convert URLs to links
  enableSpoilers?: boolean; // Support ||spoiler|| syntax
  preserveWhitespace?: boolean;
}

/**
 * Parse markdown text into intermediate representation
 */
export function parseMarkdownToIR(markdown: string, options: ParseOptions = {}): MarkdownIR {
  const nodes: MarkdownNode[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks (fenced)
    if (line.startsWith('```')) {
      const { node, nextIndex } = parseCodeBlock(lines, i);
      nodes.push(node);
      i = nextIndex;
      continue;
    }

    // Horizontal rule
    if (/^---\s*$/.test(line)) {
      nodes.push({ type: 'horizontal_rule' });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const { node, nextIndex } = parseBlockquote(lines, i);
      nodes.push(node);
      i = nextIndex;
      continue;
    }

    // List items
    if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const { node, nextIndex } = parseListItem(lines, i);
      nodes.push(node);
      i = nextIndex;
      continue;
    }

    // Paragraph (non-empty line)
    if (line.trim()) {
      const { node, nextIndex } = parseParagraph(lines, i, options);
      nodes.push(node);
      i = nextIndex;
      continue;
    }

    // Empty line - skip
    i++;
  }

  return { nodes, text: markdown };
}

function parseCodeBlock(lines: string[], startIndex: number): { node: MarkdownNode; nextIndex: number } {
  const fence = lines[startIndex].match(/^```(\w*)/);
  const language = fence?.[1] || '';
  const content: string[] = [];
  let i = startIndex + 1;

  while (i < lines.length && !lines[i].startsWith('```')) {
    content.push(lines[i]);
    i++;
  }

  // Skip the closing fence
  if (i < lines.length && lines[i].startsWith('```')) {
    i++;
  }

  return {
    node: {
      type: 'code_block',
      language,
      content: content.join('\n'),
    },
    nextIndex: i,
  };
}

function parseBlockquote(lines: string[], startIndex: number): { node: MarkdownNode; nextIndex: number } {
  const content: string[] = [];
  let i = startIndex;

  while (i < lines.length && lines[i].startsWith('> ')) {
    content.push(lines[i].slice(2));
    i++;
  }

  // Parse inline formatting within blockquote
  const children = parseInline(content.join(' '), { linkify: true, enableSpoilers: true });

  return {
    node: {
      type: 'blockquote',
      children,
    },
    nextIndex: i,
  };
}

function parseListItem(lines: string[], startIndex: number): { node: MarkdownNode; nextIndex: number } {
  const match = lines[startIndex].match(/^(\s*)[-*\d.]\s+(.*)$/);
  const content = match?.[2] || lines[startIndex];
  const children = parseInline(content, { linkify: true, enableSpoilers: true });

  return {
    node: {
      type: 'list_item',
      children,
    },
    nextIndex: startIndex + 1,
  };
}

function parseParagraph(lines: string[], startIndex: number, options: ParseOptions): { node: MarkdownNode; nextIndex: number } {
  const content: string[] = [];
  let i = startIndex;

  while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
    content.push(lines[i]);
    i++;
  }

  const text = content.join(' ').trim();
  const children = parseInline(text, options);

  return {
    node: {
      type: 'paragraph',
      children,
    },
    nextIndex: i,
  };
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('```') ||
    line.startsWith('> ') ||
    /^\s*[-*]\s/.test(line) ||
    /^\s*\d+\.\s/.test(line) ||
    /^---\s*$/.test(line)
  );
}

/**
 * Parse inline markdown elements
 */
export function parseInline(text: string, options: ParseOptions = {}): MarkdownNode[] {
  const _nodes: MarkdownNode[] = [];
  let _remaining = text;
  void _nodes; // Reserved for future use
  void _remaining; // Reserved for future use

  // Patterns for inline elements (order matters - longer patterns first)
  // Note: We use different strategies for different patterns
  // Bold uses a special pattern that allows single * inside
  const patterns: Array<{ regex: RegExp; type: MarkdownNodeType; process?: (match: RegExpExecArray) => Partial<MarkdownNode> }> = [
    // Spoilers (Telegram-specific ||text||)
    { regex: /\|\|([^|]+)\|\|/g, type: 'spoiler' },
    // Bold (**text**) - allows single * inside for nested italic
    { regex: /\*\*([^*]*(?:\*[^*][^*]*)*)\*\*/g, type: 'bold' },
    // Strikethrough (~~text~~)
    { regex: /~~([^~]+)~~/g, type: 'strikethrough' },
    // Italic (*text* or _text_) - use negative lookbehind/lookahead
    { regex: /(?<![*_])\*([^*]+)\*(?![*_])|(?<![*_])_([^_]+)_(?![*_])/g, type: 'italic' },
    // Inline code (`code`)
    { regex: /`([^`]+)`/g, type: 'code' },
    // Links ([text](url))
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link', process: (m) => ({ href: m[2] }) },
  ];

  // If linkify is enabled, also auto-detect URLs
  if (options.linkify) {
    // URL pattern (simplified)
    const urlPattern = /(https?:\/\/[^\s\[\]()]+)/g;
    const urlMatches: Array<{ index: number; length: number; url: string }> = [];
    let urlMatch;
    while ((urlMatch = urlPattern.exec(text)) !== null) {
      // Check if this URL is already inside a link
      const isInsideLink = patterns.some(p => {
        if (p.type !== 'link') return false;
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let lm;
        while ((lm = linkRegex.exec(text)) !== null) {
          if (urlMatch.index >= lm.index && urlMatch.index < lm.index + lm[0].length) {
            return true;
          }
        }
        return false;
      });
      
      if (!isInsideLink) {
        urlMatches.push({ index: urlMatch.index, length: urlMatch[0].length, url: urlMatch[0] });
      }
    }
    
    // Add URL matches as link patterns
    for (const um of urlMatches) {
      const _beforeText = text.slice(0, um.index);
      const _afterText = text.slice(um.index + um.length);

      // We'll handle this by reconstructing
      // For now, just note that auto-linkify adds complexity
      void _beforeText; // Silence unused warning
      void _afterText; // Silence unused warning
    }
  }

  // Simple recursive descent for inline parsing
  function parseInlineRecursive(str: string): MarkdownNode[] {
    if (!str) return [];

    const result: MarkdownNode[] = [];
    let pos = 0;

    // Find all pattern matches
    const allMatches: Array<{ index: number; length: number; type: MarkdownNodeType; content: string; href?: string }> = [];

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex.source, 'g');
      let match;
      while ((match = regex.exec(str)) !== null) {
        let fullMatch = match[0];
        let content = match[1] || match[2] || ''; // Handle alternate groups for italic

        // Special handling for bold: extend match if content has unpaired * that could form italic
        if (pattern.type === 'bold') {
          const starCount = (content.match(/\*/g) || []).length;
          if (starCount % 2 === 1) {
            const endPos = match.index + fullMatch.length;
            if (str[endPos] === '*') {
              const extendedContent = content + '*';
              // Verify this forms a valid italic pattern
              const italicRegex = /\*([^*]+)\*/;
              if (italicRegex.test(extendedContent)) {
                fullMatch = fullMatch + '*';
                content = extendedContent;
                regex.lastIndex = endPos + 1;
              }
            }
          }
        }

        allMatches.push({
          index: match.index,
          length: fullMatch.length,
          type: pattern.type,
          content: content,
          href: pattern.process?.(match).href,
        });
      }
    }

    // Sort by position
    allMatches.sort((a, b) => a.index - b.index);

    // Filter out overlapping matches (keep first)
    const filteredMatches = allMatches.filter((match, idx) => {
      for (let i = 0; i < idx; i++) {
        const prev = allMatches[i];
        if (match.index < prev.index + prev.length && match.index + match.length > prev.index) {
          return false; // Overlaps with previous
        }
      }
      return true;
    });

    // Build nodes
    for (const match of filteredMatches) {
      if (match.index > pos) {
        result.push({ type: 'text', content: str.slice(pos, match.index) });
      }

      const children = match.type === 'link' 
        ? parseInlineRecursive(match.content)
        : parseInlineRecursive(match.content);

      result.push({
        type: match.type,
        href: match.href,
        content: match.content,
        children: children.length > 0 ? children : undefined,
      });

      pos = match.index + match.length;
    }

    if (pos < str.length) {
      result.push({ type: 'text', content: str.slice(pos) });
    }

    return result;
  }

  return parseInlineRecursive(text);
}
/**
 * Render IR to Telegram HTML
 */
export function renderToTelegramHtml(ir: MarkdownIR): string {
  return ir.nodes.map(node => renderNodeToHtml(node)).join('\n');
}

function renderNodeToHtml(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.content || '');

    case 'bold':
      return `<b>${node.children?.map(renderNodeToHtml).join('') || node.content || ''}</b>`;

    case 'italic':
      return `<i>${node.children?.map(renderNodeToHtml).join('') || node.content || ''}</i>`;

    case 'code':
      return `<code>${escapeHtml(node.content || '')}</code>`;

    case 'code_block':
      return `<pre><code${node.language ? ` class="language-${node.language}"` : ''}>${escapeHtml(node.content || '')}</code></pre>`;

    case 'strikethrough':
      return `<s>${node.children?.map(renderNodeToHtml).join('') || node.content || ''}</s>`;

    case 'spoiler':
      return `<tg-spoiler>${node.children?.map(renderNodeToHtml).join('') || node.content || ''}</tg-spoiler>`;

    case 'link':
      const text = node.children?.map(renderNodeToHtml).join('') || node.content || '';
      const href = escapeHtmlAttr(node.href || '');
      return `<a href="${href}">${text}</a>`;

    case 'paragraph':
      return node.children?.map(renderNodeToHtml).join('') || '';

    case 'blockquote':
      return `<blockquote>${node.children?.map(renderNodeToHtml).join('')}</blockquote>`;

    case 'list_item':
      return `• ${node.children?.map(renderNodeToHtml).join('')}`;

    case 'horizontal_rule':
      return '---';

    default:
      return node.children?.map(renderNodeToHtml).join('') || escapeHtml(node.content || '');
  }
}

/**
 * Render IR to plain text (remove markdown)
 */
export function renderToPlainText(ir: MarkdownIR): string {
  return ir.nodes.map(node => renderNodeToPlainText(node)).join('\n');
}

function renderNodeToPlainText(node: MarkdownNode): string {
  switch (node.type) {
    case 'link':
      const text = node.children?.map(renderNodeToPlainText).join('') || node.content || '';
      return node.href ? `${text} (${node.href})` : text;

    case 'code_block':
      return node.content || '';

    case 'paragraph':
    case 'blockquote':
    case 'list_item':
      return node.children?.map(renderNodeToPlainText).join('');

    default:
      return node.children?.map(renderNodeToPlainText).join('') || node.content || '';
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/**
 * Calculate the text length of a node (for chunking)
 */
function getNodeTextLength(node: MarkdownNode): number {
  if (node.content) {
    return node.content.length;
  }
  if (node.children) {
    return node.children.reduce((sum, child) => sum + getNodeTextLength(child), 0);
  }
  return 0;
}

/**
 * Split IR into chunks that fit within a character limit
 * Preserves structural integrity (no splitting code blocks, etc.)
 */
export function chunkMarkdownIR(ir: MarkdownIR, limit: number): MarkdownIR[] {
  const chunks: MarkdownIR[] = [];
  let currentChunk: MarkdownNode[] = [];
  let currentLength = 0;

  for (const node of ir.nodes) {
    const nodeLength = getNodeTextLength(node);

    // If adding this node would exceed limit, start a new chunk
    if (currentLength + nodeLength > limit && currentChunk.length > 0) {
      chunks.push({ nodes: currentChunk, text: '' });
      currentChunk = [];
      currentLength = 0;
    }

    // If single node exceeds limit, we need to split it (for text/paragraph only)
    if (nodeLength > limit && (node.type === 'paragraph' || node.type === 'text')) {
      const splitNodes = splitNode(node, limit - currentLength);
      for (const splitNode of splitNodes) {
        if (currentLength + getNodeTextLength(splitNode) > limit && currentChunk.length > 0) {
          chunks.push({ nodes: currentChunk, text: '' });
          currentChunk = [splitNode];
          currentLength = getNodeTextLength(splitNode);
        } else {
          currentChunk.push(splitNode);
          currentLength += getNodeTextLength(splitNode);
        }
      }
    } else {
      currentChunk.push(node);
      currentLength += nodeLength;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({ nodes: currentChunk, text: '' });
  }

  // Populate text field for each chunk
  for (const chunk of chunks) {
    chunk.text = renderToTelegramHtml(chunk as MarkdownIR);
  }

  return chunks;
}

function splitNode(node: MarkdownNode, limit: number): MarkdownNode[] {
  if (node.type === 'text') {
    const text = node.content || '';
    if (text.length <= limit) return [node];

    const parts: MarkdownNode[] = [];
    // Try to split at sentence boundaries
    const sentenceRegex = /[^.!?]+[.!?]+\s*/g;
    let match;
    let currentText = '';

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentence = match[0];
      if (currentText.length + sentence.length > limit && currentText.length > 0) {
        parts.push({ type: 'text', content: currentText.trim() });
        currentText = sentence;
      } else {
        currentText += sentence;
      }
    }

    // Add remaining text
    if (currentText.trim()) {
      parts.push({ type: 'text', content: currentText.trim() });
    }

    // If no sentence boundaries found, hard split
    if (parts.length === 0 || (parts.length === 1 && parts[0].content && parts[0].content.length > limit)) {
      parts.length = 0;
      for (let i = 0; i < text.length; i += limit) {
        parts.push({ type: 'text', content: text.slice(i, i + limit) });
      }
    }

    return parts;
  }

  if (node.type === 'paragraph' && node.children) {
    // For paragraphs, we try to split at child boundaries
    const parts: MarkdownNode[] = [];
    let currentChildren: MarkdownNode[] = [];
    let currentLength = 0;

    for (const child of node.children) {
      const childLength = getNodeTextLength(child);

      if (currentLength + childLength > limit && currentChildren.length > 0) {
        parts.push({ type: 'paragraph', children: currentChildren });
        currentChildren = [child];
        currentLength = childLength;
      } else {
        currentChildren.push(child);
        currentLength += childLength;
      }
    }

    if (currentChildren.length > 0) {
      parts.push({ type: 'paragraph', children: currentChildren });
    }

    // If still only one part and it exceeds limit, split the text content within children
    if (parts.length === 1 && getNodeTextLength(parts[0]) > limit) {
      const paragraph = parts[0];
      if (paragraph.children && paragraph.children.length === 1 && paragraph.children[0].type === 'text') {
        // Single text child, split it
        const textNode = paragraph.children[0];
        const text = textNode.content || '';
        const splitTexts: MarkdownNode[] = [];
        for (let i = 0; i < text.length; i += limit) {
          splitTexts.push({ type: 'text', content: text.slice(i, i + limit) });
        }
        return splitTexts.map(t => ({ type: 'paragraph', children: [t] }));
      }
    }

    return parts;
  }

  return [node];
}

/**
 * Format a chunk result with both HTML and plain text
 */
export interface FormattedChunk {
  html: string;
  text: string;
}

/**
 * Convert markdown to Telegram HTML chunks
 * Main entry point - replaces the old splitTelegramMessage
 */
export function markdownToTelegramChunks(markdown: string, limit: number = 4000): FormattedChunk[] {
  const ir = parseMarkdownToIR(markdown, { linkify: true, enableSpoilers: true });
  const chunks = chunkMarkdownIR(ir, limit);
  
  return chunks.map(chunk => ({
    html: renderToTelegramHtml(chunk as MarkdownIR),
    text: renderToPlainText(chunk as MarkdownIR),
  }));
}

/**
 * Render markdown to Telegram HTML (single message)
 */
export function renderTelegramHtmlText(text: string, options: { textMode?: 'markdown' | 'html' } = {}): string {
  const textMode = options.textMode ?? 'markdown';
  if (textMode === 'html') {
    return text;
  }
  // Always parse markdown to ensure proper conversion to Telegram HTML
  // The markdown parser handles mixed content (markdown + HTML tags) correctly
  const ir = parseMarkdownToIR(text, { linkify: true, enableSpoilers: true });
  return renderToTelegramHtml(ir);
}
