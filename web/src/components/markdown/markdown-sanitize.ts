import DOMPurify from 'dompurify';

const FORBIDDEN_MARKDOWN_TAGS = [
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'option',
  'select',
  'style',
  'template',
  'textarea',
];

const FORBIDDEN_MARKDOWN_ATTRIBUTES = [
  'action',
  'formaction',
  'id',
  'name',
  'srcdoc',
  'style',
];

export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_MARKDOWN_TAGS,
    FORBID_ATTR: FORBIDDEN_MARKDOWN_ATTRIBUTES,
  });
}

export function sanitizeMermaidHtml(html: string): string {
  const withoutRemoteImports = html.replace(/@import\s+url\([^)]*\)\s*;?/gi, '');
  return DOMPurify.sanitize(withoutRemoteImports, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script'],
    FORBID_ATTR: ['href', 'xlink:href'],
  });
}

