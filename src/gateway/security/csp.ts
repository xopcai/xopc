import { createHash } from 'node:crypto';

/**
 * Compute SHA-256 CSP hashes for inline `<script>` blocks in an HTML string.
 * Only scripts without a `src` attribute are considered inline.
 */
export function computeInlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const scriptRegex = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const openTag = match[0].slice(0, match[0].indexOf('>') + 1);
    if (hasSrcAttribute(openTag)) {
      continue;
    }
    const content = match[1];
    if (!content) {
      continue;
    }
    const hash = createHash('sha256').update(content, 'utf8').digest('base64');
    hashes.push(`sha256-${hash}`);
  }
  return hashes;
}

const ATTRIBUTE_NAME_REGEX = /\s([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

function hasSrcAttribute(openTag: string): boolean {
  return Array.from(openTag.matchAll(ATTRIBUTE_NAME_REGEX)).some(
    (attrMatch) => attrMatch[1]?.toLowerCase() === 'src',
  );
}

/**
 * Build a Content-Security-Policy header string.
 *
 * For the gateway console, we use:
 * - `script-src 'self'` + optional SHA-256 hashes for inline scripts (no unsafe-inline)
 * - `style-src 'self' 'unsafe-inline'` (Tailwind + runtime style injection)
 * - `frame-ancestors 'none'` (prevent clickjacking)
 * - `base-uri 'none'` (prevent base tag hijacking)
 * - `object-src 'none'` (prevent plugin execution)
 */
export function buildGatewayConsoleCspHeader(options?: {
  inlineScriptHashes?: string[];
  connectSrc?: string;
}): string {
  const hashes = options?.inlineScriptHashes;
  const scriptSrc = hashes?.length
    ? `script-src 'self' ${hashes.map((hash) => `'${hash}'`).join(' ')}`
    : "script-src 'self'";
  const connectSrc = options?.connectSrc ?? "'self' ws: wss:";

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "worker-src 'self'",
  ].join('; ');
}
