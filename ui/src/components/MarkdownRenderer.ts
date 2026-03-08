/**
 * Simple Markdown Renderer Component
 * Lightweight markdown rendering without external dependencies
 */

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

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

  // Disable shadow DOM to allow parent styles to control text color
  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  render() {
    if (!this.content) {
      return html`\u003cdiv class="markdown-body"\u003e\u003c/div\u003e`;
    }

    const htmlContent = parseMarkdown(this.content);

    return html`
      \u003cdiv class="markdown-body"\u003e${unsafeHTML(htmlContent)}\u003c/div\u003e
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'markdown-renderer': MarkdownRenderer;
  }
}
