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
