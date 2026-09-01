import { renderMermaidSVG } from 'beautiful-mermaid';

/**
 * Render a Mermaid code block to SVG.
 *
 * Uses xopc design-system CSS variables so the diagram automatically follows
 * light/dark theme switches without re-rendering.
 */
export function renderMermaidSvg(code: string): string {
  return renderMermaidSVG(code.trim(), {
    bg: 'var(--color-surface-hover)',
    fg: 'var(--color-fg)',
    accent: 'var(--color-accent-fg)',
    border: 'var(--color-edge)',
    transparent: true,
  });
}
