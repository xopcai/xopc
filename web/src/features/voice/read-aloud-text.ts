import { marked } from 'marked';

const CODE_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const FIRST_CHUNK_LIMIT = 160;
const CHUNK_LIMIT = 420;

function fallbackMarkdownToText(markdown: string): string {
  return markdown
    .replace(CODE_FENCE_RE, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[|`*_~>]/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** Convert visible Markdown into natural speech text. Code and raw URLs are intentionally skipped. */
export function buildSpeakableText(markdown: string): string {
  if (!markdown.trim()) return '';
  const withoutCode = markdown.replace(CODE_FENCE_RE, '\n');
  let text: string;

  if (typeof DOMParser === 'undefined') {
    text = fallbackMarkdownToText(withoutCode);
  } else {
    const html = marked.parse(withoutCode, { gfm: true, breaks: false }) as string;
    const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
    doc.querySelectorAll('pre, script, style').forEach((node) => node.remove());
    doc.querySelectorAll('img').forEach((image) => image.replaceWith(image.alt || ''));
    doc.querySelectorAll('br, p, h1, h2, h3, h4, h5, h6, li, tr').forEach((node) => {
      node.append(doc.createTextNode('\n'));
    });
    text = doc.body.textContent ?? '';
  }

  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lastBreak(window: string, pattern: RegExp, limit: number): number {
  let end = 0;
  for (const match of window.matchAll(pattern)) {
    const boundary = match.index + match[0].length;
    if (boundary <= limit && boundary >= Math.floor(limit / 2)) end = boundary;
  }
  return end;
}

/** Group whole sentences and leave synthesis time for the next chunk. */
export function splitSpeakableText(text: string, maxChars = CHUNK_LIMIT): string[] {
  let rest = text.trim();
  const limit = Math.max(20, maxChars);
  let chunkLimit = Math.min(limit, FIRST_CHUNK_LIMIT);
  const chunks: string[] = [];
  while (rest.length > chunkLimit) {
    // The extra character distinguishes a period before whitespace from a decimal point.
    const window = rest.slice(0, chunkLimit + 1);
    let end = lastBreak(window, /[。！？!?]+["'”’」』）)]*|\.+["'”’」』）)]*(?=\s)|\n+/g, chunkLimit)
      || lastBreak(window, /[，、；：]|[,;:](?=\s)/g, chunkLimit)
      || lastBreak(window, /\s/g, chunkLimit)
      || chunkLimit;
    if (rest.charCodeAt(end - 1) >= 0xD800 && rest.charCodeAt(end - 1) <= 0xDBFF) end--;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
    chunkLimit = limit;
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function detectSpeechLanguage(text: string, fallback: 'en' | 'zh'): 'en-US' | 'zh-CN' {
  const hanCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (hanCount === 0 && latinCount === 0) return fallback === 'zh' ? 'zh-CN' : 'en-US';
  return hanCount * 2 >= latinCount ? 'zh-CN' : 'en-US';
}
