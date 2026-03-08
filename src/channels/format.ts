/**
 * Telegram Message Formatting Utilities
 * 
 * Converts Markdown to Telegram HTML format with proper escaping
 * and file reference protection
 * 
 * Now uses Markdown IR (Intermediate Representation) for robust parsing
 * Inspired by OpenClaw's approach
 */

import {
  parseMarkdownToIR,
  renderToPlainText,
  markdownToTelegramChunks,
  renderTelegramHtmlText,
  type FormattedChunk,
} from './markdown-ir.js';

// Re-export from markdown-ir for convenience
export { markdownToTelegramChunks, renderTelegramHtmlText, type FormattedChunk };

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
function _isAutoLinkedFileRef(href: string, label: string): boolean {
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
 * @deprecated Use renderTelegramHtmlText() or markdownToTelegramChunks() instead
 */
export function markdownToTelegramHtml(markdown: string): string {
  // Delegate to new IR-based implementation
  return renderTelegramHtmlText(markdown);
}

/**
 * Convert Markdown to plain text (strip markdown syntax)
 * Used for fallback when HTML parsing fails
 */
export function markdownToPlainText(markdown: string): string {
  const ir = parseMarkdownToIR(markdown, { linkify: true, enableSpoilers: true });
  return renderToPlainText(ir);
}

// ... rest of the file with wrapFileReferencesInHtml, fixMalformedHtml, etc.

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
 * Fix malformed HTML tags by ensuring proper nesting
 * This handles cases where LLM generates invalid HTML like:
 * - <code>git<i>diff</code> (i tag not closed)
 * - <code>git</i>log</code> (i tag closed but not opened in context)
 */
function _fixMalformedHtml(html: string): string {
  const result: string[] = [];
  const openTags: string[] = [];
  let i = 0;

  // Tags that are self-closing or should not be tracked
  const voidElements = new Set([
    'br', 'hr', 'img', 'input', 'link', 'meta', 'area', 'base', 'col', 'embed',
    'param', 'source', 'track', 'wbr'
  ]);

  // Tags that can be nested (inline elements)
  const inlineTags = new Set([
    'a', 'b', 'i', 'code', 's', 'strike', 'del', 'u', 'em', 'strong', 'span', 'tg-spoiler'
  ]);

  while (i < html.length) {
    // Check if we're at a tag
    if (html[i] === '<' && i + 1 < html.length && html[i + 1] !== '!') {
      // Find the end of the tag
      let tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        // No closing > found, treat as literal text
        result.push(html.slice(i));
        break;
      }

      const fullTag = html.slice(i, tagEnd + 1);

      // Skip HTML comments and DOCTYPE
      if (fullTag.startsWith('<!') || fullTag.startsWith('<!--')) {
        // Skip until end of comment
        const commentEnd = html.indexOf('-->', i);
        if (commentEnd !== -1) {
          i = commentEnd + 3;
        } else {
          result.push(html.slice(i));
          break;
        }
        continue;
      }

      // Check if it's a closing tag
      if (fullTag.startsWith('</')) {
        const tagName = fullTag.slice(2, -1).trim().toLowerCase().split(/\s/)[0];

        if (voidElements.has(tagName)) {
          // Invalid closing tag for void element, escape it
          result.push(escapeHtml(fullTag));
        } else {
          // Find and close the matching tag
          const lastIndex = openTags.lastIndexOf(tagName);
          if (lastIndex !== -1) {
            // Found matching tag, close all tags opened after it
            while (openTags.length > lastIndex + 1) {
              const tagToClose = openTags.pop()!;
              result.push(`</${tagToClose}>`);
            }
            // Close the matching tag
            openTags.pop();
            result.push(fullTag);
          } else {
            // No matching open tag, escape the closing tag
            result.push(escapeHtml(fullTag));
          }
        }
      } else if (fullTag.endsWith('/>') || voidElements.has(fullTag.slice(1, -1).trim().toLowerCase().split(/\s/)[0])) {
        // Self-closing tag or void element
        result.push(fullTag);
      } else {
        // Opening tag
        const tagName = fullTag.slice(1, -1).trim().toLowerCase().split(/\s/)[0];

        if (tagName && (inlineTags.has(tagName) || tagName === 'pre' || tagName === 'blockquote')) {
          // Track inline/nestableable tags
          openTags.push(tagName);
        }
        result.push(fullTag);
      }

      i = tagEnd + 1;
    } else {
      // Regular text
      result.push(html[i]);
      i++;
    }
  }

  // Close any remaining open tags
  while (openTags.length > 0) {
    result.push(`</${openTags.pop()}>`);
  }

  return result.join('');
}

/**
 * Validate HTML string for Telegram parse_mode
 * Returns true if the HTML appears to be valid
 */
export function isValidTelegramHtml(html: string): boolean {
  const voidElements = new Set([
    'br', 'hr', 'img', 'input', 'link', 'meta', 'area', 'base', 'col', 'embed',
    'param', 'source', 'track', 'wbr'
  ]);

  const openTags: string[] = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<' && i + 1 < html.length && html[i + 1] !== '!') {
      let tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) return false;

      const fullTag = html.slice(i, tagEnd + 1);

      // Skip comments
      if (fullTag.startsWith('<!') || fullTag.startsWith('<!--')) {
        const commentEnd = html.indexOf('-->', i);
        if (commentEnd !== -1) {
          i = commentEnd + 3;
        } else {
          return false;
        }
        continue;
      }

      const isClosing = fullTag.startsWith('</');
      const tagName = fullTag.slice(isClosing ? 2 : 1, -1).trim().toLowerCase().split(/\s/)[0];

      if (!tagName) {
        i = tagEnd + 1;
        continue;
      }

      if (voidElements.has(tagName)) {
        // Void elements are self-closing, no need to track
      } else if (isClosing) {
        const lastIndex = openTags.lastIndexOf(tagName);
        if (lastIndex === -1) {
          // Closing tag without matching opening
          return false;
        }
        // Close all tags between lastIndex and end
        openTags.splice(lastIndex + 1);
        openTags.pop();
      } else {
        openTags.push(tagName);
      }

      i = tagEnd + 1;
    } else {
      i++;
    }
  }

  return openTags.length === 0;
}

/**
 * Format message for Telegram with proper HTML and file reference protection
 * Now uses Markdown IR for robust parsing
 */
export function formatTelegramMessage(
  markdown: string,
  options: { wrapFileRefs?: boolean; textMode?: 'markdown' | 'html' } = {}
): { html: string; text: string } {
  const html = renderTelegramHtmlText(markdown, { textMode: options.textMode });
  
  // Wrap file references if enabled
  const finalHtml = options.wrapFileRefs !== false
    ? wrapFileReferencesInHtml(html)
    : html;

  return {
    html: finalHtml,
    text: markdown,
  };
}

/**
 * Split long message into chunks respecting code blocks and paragraphs
 * @deprecated Use markdownToTelegramChunks() instead for IR-based chunking
 */
export function splitTelegramMessage(
  text: string,
  maxChars: number = 4000
): string[] {
  // Delegate to new IR-based chunking
  const chunks = markdownToTelegramChunks(text, maxChars);
  return chunks.map(c => c.html);
}

/**
 * Smart split message into chunks with both HTML and plain text
 * Uses Markdown IR for robust chunking that preserves structure
 */
export function splitTelegramMessageSmart(
  markdown: string,
  maxChars: number = 4000
): FormattedChunk[] {
  return markdownToTelegramChunks(markdown, maxChars);
}
