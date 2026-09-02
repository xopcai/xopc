const REMOTE_REFERENCE_RE = /^ {0,3}\[([^\]]+)\]:\s*<?(https?:\/\/[^\s>]+)>?(?:\s+.*)?$/gim;
const REMOTE_INLINE_IMAGE_RE = /!\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi;
const REFERENCE_IMAGE_RE = /!\[([^\]]*)\]\[([^\]]+)\]/g;

/** Render remote Markdown images as links so a public share never leaks viewer network metadata. */
export function blockRemoteMarkdownImages(markdown: string, fallbackLabel: string): string {
  const remoteReferences = new Map<string, string>();
  for (const match of markdown.matchAll(REMOTE_REFERENCE_RE)) {
    remoteReferences.set(normalizeReference(match[1] ?? ''), match[2] ?? '');
  }

  return markdown
    .replace(REMOTE_INLINE_IMAGE_RE, (_match, alt: string, url: string) => `[${alt.trim() || fallbackLabel}](${url})`)
    .replace(REFERENCE_IMAGE_RE, (match, alt: string, reference: string) => {
      const url = remoteReferences.get(normalizeReference(reference));
      return url ? `[${alt.trim() || fallbackLabel}](${url})` : match;
    });
}

function normalizeReference(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
