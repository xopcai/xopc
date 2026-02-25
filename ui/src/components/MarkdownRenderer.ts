/**
 * Simple Markdown Renderer Component
 * Lightweight markdown rendering without external dependencies
 */

import { html, LitElement, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

const styles = `
:host { display: block; }

.markdown-body {
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--text-primary);
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin-top: 1.5em;
  margin-bottom: 0.75em;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body h1 { font-size: 1.5em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
.markdown-body h2 { font-size: 1.3em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
.markdown-body h3 { font-size: 1.1em; }
.markdown-body p { margin-bottom: 1em; }

.markdown-body ul,
.markdown-body ol {
  margin-bottom: 1em;
  padding-left: 2em;
}

.markdown-body li { margin-bottom: 0.25em; }

.markdown-body code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--bg-secondary);
  padding: 0.15em 0.4em;
  border-radius: var(--radius-sm);
  color: var(--accent-primary);
}

.markdown-body pre {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  padding: 1em;
  overflow-x: auto;
  margin-bottom: 1em;
}

.markdown-body pre code {
  background: transparent;
  padding: 0;
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.markdown-body blockquote {
  margin: 0 0 1em;
  padding: 0.75em 1em;
  border-left: 4px solid var(--accent-primary);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

.markdown-body a {
  color: var(--accent-primary);
  text-decoration: none;
}

.markdown-body a:hover { text-decoration: underline; }

.markdown-body hr {
  height: 1px;
  background: var(--border-color);
  border: none;
  margin: 1.5em 0;
}

.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1em;
}

.markdown-body th,
.markdown-body td {
  padding: 0.5em 0.75em;
  border: 1px solid var(--border-color);
  text-align: left;
}

.markdown-body th {
  background: var(--bg-secondary);
  font-weight: 600;
}

.markdown-body strong { font-weight: 600; }
.markdown-body em { font-style: italic; }
`;

/**
 * Simple markdown parser
 * Supports: headers, bold, italic, code, code blocks, links, lists, blockquotes, tables, hr
 */
function parseMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      return `\u003cpre\u003e\u003ccode class="language-${lang || 'text'}"\u003e${code.trim()}\u003c/code\u003e\u003c/pre\u003e`;
    })
    
    // Inline code
    .replace(/`([^`]+)`/g, '\u003ccode\u003e$1\u003c/code\u003e')
    
    // Headers
    .replace(/^###### (.*$)/gim, '\u003ch6\u003e$1\u003c/h6\u003e')
    .replace(/^##### (.*$)/gim, '\u003ch5\u003e$1\u003c/h5\u003e')
    .replace(/^#### (.*$)/gim, '\u003ch4\u003e$1\u003c/h4\u003e')
    .replace(/^### (.*$)/gim, '\u003ch3\u003e$1\u003c/h3\u003e')
    .replace(/^## (.*$)/gim, '\u003ch2\u003e$1\u003c/h2\u003e')
    .replace(/^# (.*$)/gim, '\u003ch1\u003e$1\u003c/h1\u003e')
    
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '\u003cstrong\u003e\u003cem\u003e$1\u003c/em\u003e\u003c/strong\u003e')
    .replace(/\*\*(.*?)\*\*/g, '\u003cstrong\u003e$1\u003c/strong\u003e')
    .replace(/\*(.*?)\*/g, '\u003cem\u003e$1\u003c/em\u003e')
    .replace(/___(.*?)___/g, '\u003cstrong\u003e\u003cem\u003e$1\u003c/em\u003e\u003c/strong\u003e')
    .replace(/__(.*?)__/g, '\u003cstrong\u003e$1\u003c/strong\u003e')
    .replace(/_(.*?)_/g, '\u003cem\u003e$1\u003c/em\u003e')
    
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\u003ca href="$2" target="_blank" rel="noopener"\u003e$1\u003c/a\u003e')
    
    // Horizontal rule
    .replace(/^---$/gim, '\u003chr\u003e')
    
    // Blockquotes
    .replace(/^\> (.*$)/gim, '\u003cblockquote\u003e$1\u003c/blockquote\u003e')
    
    // Lists
    .replace(/^\* (.*$)/gim, '\u003cli\u003e$1\u003c/li\u003e')
    .replace(/^- (.*$)/gim, '\u003cli\u003e$1\u003c/li\u003e')
    .replace(/^\d+\. (.*$)/gim, '\u003cli\u003e$1\u003c/li\u003e');

  // Wrap consecutive list items
  html = html
    .replace(/(\u003cli\u003e.*\u003c\/li\u003e\n?)+/g, (match) => {
      if (match.includes('*') || match.includes('-')) {
        return `\u003cul\u003e${match}\u003c/ul\u003e`;
      }
      return `\u003col\u003e${match}\u003c/ol\u003e`;
    });

  // Wrap in paragraphs (simple approach)
  const lines = html.split('\n');
  let result = '';
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inParagraph) {
        result += '\u003c/p\u003e\n';
        inParagraph = false;
      }
      continue;
    }

    // Skip if already wrapped in block element
    if (/^\u003c(h\d|pre|ul|ol|blockquote|hr)/.test(trimmed)) {
      if (inParagraph) {
        result += '\u003c/p\u003e\n';
        inParagraph = false;
      }
      result += line + '\n';
    } else {
      if (!inParagraph) {
        result += '\u003cp\u003e';
        inParagraph = true;
      }
      result += line + ' ';
    }
  }

  if (inParagraph) {
    result += '\u003c/p\u003e\n';
  }

  return result;
}

@customElement('markdown-renderer')
export class MarkdownRenderer extends LitElement {
  @property({ type: String }) content = '';

  static styles = unsafeCSS(styles);

  render() {
    if (!this.content) {
      return html`\u003cdiv class="markdown-body"\u003e\u003c/div\u003e`;
    }

    const htmlContent = parseMarkdown(this.content);

    return html`
      \u003cdiv class="markdown-body" ${unsafeHTML(htmlContent)}\u003e\u003c/div\u003e
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'markdown-renderer': MarkdownRenderer;
  }
}
