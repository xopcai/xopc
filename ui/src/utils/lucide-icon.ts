import { html, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

/** Lucide icons are array tuples [tag, attrs, children]. */
export function iconToSvg(iconData: unknown, className = ''): string {
  if (!iconData || !Array.isArray(iconData)) return '';

  const [_tag, attrs, children] = iconData as [string, Record<string, string>, unknown[]];

  const attrStr = Object.entries(attrs || {})
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  const childrenStr = Array.isArray(children)
    ? children
        .map((child) => {
          if (Array.isArray(child)) {
            const [cTag, cAttrs] = child;
            const cAttrStr = Object.entries(cAttrs || {})
              .map(([k, v]) => `${k}="${v}"`)
              .join(' ');
            return `<${cTag} ${cAttrStr} />`;
          }
          return '';
        })
        .join('')
    : '';

  const finalAttrs = className ? `${attrStr} class="${className}"` : attrStr;

  return `<svg ${finalAttrs}>${childrenStr}</svg>`;
}

export function lucideIcon(iconData: unknown, className = 'w-4 h-4'): TemplateResult {
  return html`${unsafeHTML(iconToSvg(iconData, className))}`;
}
