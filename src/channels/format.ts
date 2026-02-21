/**
 * Telegram Message Formatting Utilities
 * 
 * Converts Markdown to Telegram HTML format with proper escaping
 * and file reference protection
 * 
 * Inspired by openclaw's format.ts
 */

// File extensions that share TLDs and commonly appear in code/documentation
const FILE_EXTENSIONS_WITH_TLD = new Set([
  'md', // Markdown (Moldova)
  'go', // Go language
  'py', // Python (Paraguay)
  'pl', // Perl (Poland)
  'sh', // Shell (Saint Helena)
  'am', // Automake files (Armenia)
  'at', // Assembly (Austria)
  'be', // Backend files (Belgium)
  'cc', // C++ source (Cocos Islands)
]);

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape HTML attribute values
 */
export function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/**
 * Detect if a link is an auto-linked file reference
 */
function isAutoLinkedFileRef(href: string, label: string): boolean {
  const stripped = href.replace(/^https?:\/\//i, '');
  if (stripped !== label) {
    return false;
  }
  const dotIndex = label.lastIndexOf('.');
  if (dotIndex < 1) {
    return false;
  }
  const ext = label.slice(dotIndex + 1).toLowerCase();
  return FILE_EXTENSIONS_WITH_TLD.has(ext);
}

/**
 * Simple Markdown to HTML converter for Telegram
 */
export function markdownToTelegramHtml(markdown: string): string {
  let html = escapeHtml(markdown);

  // Code blocks (must be before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  html = html.replace(/_([^_]+)_/g, '<i>$1</i>');

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, href) => {
    if (isAutoLinkedFileRef(href, text)) {
      return `<code>${escapeHtml(text)}</code>`;
    }
    const safeHref = escapeHtmlAttr(href);
    return `<a href="${safeHref}">${text}</a>`;
  });

  // Blockquotes
  html = html.replace(/^&gt; (.*$)/gm, '<blockquote>$1</blockquote>');

  // Spoilers (Telegram-specific)
  html = html.replace(/~~\|([^|]+)\|~~/g, '<tg-spoiler>$1</tg-spoiler>');

  return html;
}

/**
 * Wrap standalone file references in &lt;code&gt; tags
 * Prevents Telegram from generating domain registrar previews
 */
export function wrapFileReferencesInHtml(html: string): string {
  // Track nesting depth for tags that should not be modified
  let codeDepth = 0;
  let preDepth = 0;
  let anchorDepth = 0;
  let result = '';
  let lastIndex = 0;

  const HTML_TAG_PATTERN = /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/gi;
  let match: RegExpExecArray | null;

  while ((match = HTML_TAG_PATTERN.exec(html)) !== null) {
    const tagStart = match.index;
    const tagEnd = tagStart + match[0].length;
    const tagName = match[2].toLowerCase();
    const isClosing = match[1] === '</';

    // Process text before this tag
    if (tagStart > lastIndex) {
      const textSegment = html.slice(lastIndex, tagStart);
      result += wrapSegmentFileRefs(textSegment, codeDepth, preDepth, anchorDepth);
    }

    // Update nesting depth
    if (tagName === 'code') {
      codeDepth += isClosing ? -1 : 1;
    } else if (tagName === 'pre') {
      preDepth += isClosing ? -1 : 1;
    } else if (tagName === 'a') {
      anchorDepth += isClosing ? -1 : 1;
    }

    // Add the tag itself
    result += match[0];
    lastIndex = tagEnd;
  }

  // Process remaining text after last tag
  if (lastIndex < html.length) {
    const textSegment = html.slice(lastIndex);
    result += wrapSegmentFileRefs(textSegment, codeDepth, preDepth, anchorDepth);
  }

  return result;
}

/**
 * Wrap file references in a text segment (respecting nesting depth)
 */
function wrapSegmentFileRefs(
  text: string,
  codeDepth: number,
  preDepth: number,
  anchorDepth: number
): string {
  if (!text || codeDepth > 0 || preDepth > 0 || anchorDepth > 0) {
    return text;
  }

  const FILE_EXTENSIONS_PATTERN = Array.from(FILE_EXTENSIONS_WITH_TLD).join('|');
  const FILE_REFERENCE_PATTERN = new RegExp(
    `(^|[^a-zA-Z0-9_\\-/])([a-zA-Z0-9_.\\-./]+\\.(?:${FILE_EXTENSIONS_PATTERN}))(?=$|[^a-zA-Z0-9_\\-/])`,
    'gi'
  );

  return text.replace(FILE_REFERENCE_PATTERN, (match, prefix, filename) => {
    if (filename.startsWith('//')) {
      return match;
    }
    if (/https?:\/\/$/i.test(prefix)) {
      return match;
    }
    return `${prefix}<code>${escapeHtml(filename)}</code>`;
  });
}

/**
 * Format message for Telegram with proper HTML and file reference protection
 */
export function formatTelegramMessage(
  markdown: string,
  options: { wrapFileRefs?: boolean } = {}
): { html: string; text: string } {
  const html = markdownToTelegramHtml(markdown);
  const wrappedHtml = options.wrapFileRefs !== false
    ? wrapFileReferencesInHtml(html)
    : html;

  return {
    html: wrappedHtml,
    text: markdown,
  };
}

/**
 * Split long message into chunks respecting code blocks and paragraphs
 */
export function splitTelegramMessage(
  text: string,
  maxChars: number = 4000
): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    // Try to split at paragraph boundary
    let splitIndex = remaining.lastIndexOf('\n\n', maxChars);

    // If no paragraph boundary, try newline
    if (splitIndex === -1 || splitIndex < maxChars * 0.5) {
      splitIndex = remaining.lastIndexOf('\n', maxChars);
    }

    // If still no good split point, hard split
    if (splitIndex === -1 || splitIndex < maxChars * 0.5) {
      splitIndex = maxChars;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}
