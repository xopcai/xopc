import { renderMermaidSVG } from 'beautiful-mermaid';

export interface MermaidRenderResult {
  html: string;
  error: boolean;
}

/**
 * Render a mermaid code block to an SVG diagram wrapped in a container div.
 *
 * Uses xopc design-system CSS variables so the diagram automatically follows
 * light/dark theme switches without re-rendering.
 *
 * On parse failure, falls back to a plain code-block showing the raw source.
 */
export function renderMermaidBlock(code: string): MermaidRenderResult {
  try {
    const svg = renderMermaidSVG(code.trim(), {
      bg: 'var(--color-surface-hover)',
      fg: 'var(--color-fg)',
      accent: 'var(--color-accent-fg)',
      border: 'var(--color-edge)',
      transparent: true,
    });
    return {
      html: `<div class="markdown-mermaid" data-mermaid-diagram>${svg}</div>`,
      error: false,
    };
  } catch {
    // Parse failure — degrade gracefully to a plain code block
    return {
      html: `<div class="markdown-mermaid markdown-mermaid-fallback" data-mermaid-fallback><pre><code class="hljs language-mermaid">${escapeHtml(code)}</code></pre></div>`,
      error: true,
    };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Reverse the HTML-entity escaping that marked applies inside code blocks. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/**
 * Post-process marked HTML output: replace `<pre><code class="language-mermaid">`
 * blocks with rendered SVG diagrams.
 *
 * This is intentionally a post-process step (not a marked renderer override)
 * so it doesn't conflict with `markedHighlight`'s code hook.
 */
export function replaceMermaidBlocks(html: string): string {
  return html.replace(
    /<pre><code class="(?:hljs\s+)?language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_, code) => renderMermaidBlock(unescapeHtml(code)).html,
  );
}
