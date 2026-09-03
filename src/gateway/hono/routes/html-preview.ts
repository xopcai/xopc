import type { Hono } from 'hono';

export const HTML_PREVIEW_PATH = '/api/preview/html';

const HTML_PREVIEW_SANDBOX =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals';

const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  `sandbox ${HTML_PREVIEW_SANDBOX}`,
  "script-src 'unsafe-inline' https: blob:",
  "style-src 'unsafe-inline' https:",
  'img-src https: data: blob:',
  'media-src https: data: blob:',
  'font-src https: data:',
  'connect-src https:',
  "frame-src 'self' about:",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  'form-action https:',
].join('; ');

// A network-loaded document owns its CSP; srcdoc/blob previews in the console
// inherit the console's script restrictions. Keep user HTML in a nested frame
// so it cannot replace the message listener used for subsequent preview updates.
const HTML_PREVIEW_SHELL = `<!doctype html>
<html><head><meta charset="utf-8"><title>HTML preview</title>
<style>html,body{height:100%;margin:0;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>
</head><body><iframe title="HTML preview" sandbox="${HTML_PREVIEW_SANDBOX}"></iframe>
<script>
const preview = document.querySelector('iframe');
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || window.parent === window) return;
  const data = event.data;
  if (!data || data.type !== 'xopc-html-preview' || typeof data.html !== 'string') return;
  // Repeated load notifications must not restart scripts or discard preview state.
  if (preview.srcdoc !== data.html) preview.srcdoc = data.html;
});
</script></body></html>`;

/** Public static shell only: file contents arrive from the authenticated UI, never a URL. */
export function registerPublicHtmlPreviewRoute(app: Hono): void {
  app.get(HTML_PREVIEW_PATH, (c) => c.html(HTML_PREVIEW_SHELL, 200, {
    'Content-Security-Policy': HTML_PREVIEW_CSP,
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  }));
}
