/**
 * Helpers for exporting chat session transcripts to workspace files (HTML wrapper).
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function wrapMarkdownExportAsHtml(title: string, markdownBody: string): string {
  const safeTitle = escapeHtml(title);
  const body = escapeHtml(markdownBody);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f4f4f5; padding: 1rem; border-radius: 8px; }
    @media (prefers-color-scheme: dark) {
      body { background: #18181b; color: #e4e4e7; }
      pre { background: #27272a; }
    }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <pre>${body}</pre>
</body>
</html>
`;

}
