const CODE_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const SENTENCE_RE = /[^。！？!?.\n]+[。！？!?.]?|\n+/g;

/** Convert assistant Markdown into natural speech without code, URLs, or hidden delivery metadata. */
export function buildSpeakableText(markdown: string): string {
  return markdown
    .replace(CODE_FENCE_RE, '\n')
    .replace(/xopc-product-delivery:\S+/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[|`*_~>]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split text on sentence boundaries so each request stays comfortably below the server limit. */
export function splitSpeakableText(text: string, maxChars = 420): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const limit = Math.max(20, maxChars);
  const units = normalized.match(SENTENCE_RE) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };

  for (const rawUnit of units) {
    const unit = rawUnit.trim();
    if (!unit) continue;
    if (unit.length > limit) {
      pushCurrent();
      for (let offset = 0; offset < unit.length; offset += limit) {
        chunks.push(unit.slice(offset, offset + limit).trim());
      }
      continue;
    }
    if (current && current.length + unit.length > limit) pushCurrent();
    current += unit;
  }
  pushCurrent();
  return chunks;
}

export function detectSpeechLanguage(text: string, fallback: 'en' | 'zh'): 'en-US' | 'zh-CN' {
  const hanCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (hanCount === 0 && latinCount === 0) return fallback === 'zh' ? 'zh-CN' : 'en-US';
  return hanCount * 2 >= latinCount ? 'zh-CN' : 'en-US';
}
