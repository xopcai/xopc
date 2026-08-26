// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  calculateMermaidPngDimensions,
  createMermaidSnapshot,
} from '@/components/markdown/mermaid-export';

describe('Mermaid export', () => {
  it('creates a standalone themed and sanitized SVG snapshot', () => {
    const host = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1200 400');
    svg.style.setProperty('--bg', 'var(--color-surface-hover)');
    svg.style.setProperty('--fg', 'var(--color-fg)');
    svg.innerHTML = [
      '<style>@import url(https://example.invalid/font.css); text { fill: var(--fg); }</style>',
      '<script>alert(1)</script>',
      '<foreignObject><div>unsafe</div></foreignObject>',
      '<text x="10" y="20">Safe</text>',
    ].join('');
    host.appendChild(svg);
    document.body.appendChild(host);

    const snapshot = createMermaidSnapshot(svg, host);

    expect(snapshot.width).toBe(1200);
    expect(snapshot.height).toBe(400);
    expect(snapshot.svg).toContain('data-mermaid-export-background');
    expect(snapshot.svg).not.toContain('@import');
    expect(snapshot.svg).not.toContain('<script');
    expect(snapshot.svg).not.toContain('foreignObject');
    expect(snapshot.svg).not.toContain('var(--color-surface-hover)');
    expect(snapshot.svg).not.toContain('var(--color-fg)');
    host.remove();
  });

  it('caps large PNG exports by dimension and total pixel area', () => {
    const result = calculateMermaidPngDimensions(12_000, 6_000);

    expect(result.width).toBeLessThanOrEqual(8192);
    expect(result.height).toBeLessThanOrEqual(8192);
    expect(result.width * result.height).toBeLessThanOrEqual(32_000_000);
    expect(result.scale).toBeLessThan(1);
  });
});
