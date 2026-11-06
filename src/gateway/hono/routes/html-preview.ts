import type { Hono } from 'hono';

import { HTML_PREVIEW_HEADERS, HTML_PREVIEW_PATH, HTML_PREVIEW_SHELL } from '../../html-preview-shell.js';

/** Public static shell only: file contents arrive from the authenticated UI, never a URL. */
export function registerPublicHtmlPreviewRoute(app: Hono): void {
  app.get(HTML_PREVIEW_PATH, (c) => c.html(HTML_PREVIEW_SHELL, 200, HTML_PREVIEW_HEADERS));
}
