const CODE_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const SENTENCE_RE = /[^。！？!?.\n]+[。！？!?.]?|\n+/g;
const FIRST_CHUNK_MAX_CHARS = 80;
const FOLLOWING_CHUNK_MAX_CHARS = 240;

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

/** Keep the first sentence small for fast first audio, then pack later speech more densely. */
export function splitSpeakableText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const units = normalized.match(SENTENCE_RE) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };

  const firstUnit = units.shift()?.trim() ?? '';
  if (firstUnit) {
    for (let offset = 0; offset < firstUnit.length; offset += FIRST_CHUNK_MAX_CHARS) {
      chunks.push(firstUnit.slice(offset, offset + FIRST_CHUNK_MAX_CHARS).trim());
    }
  }

  for (const rawUnit of units) {
    const unit = rawUnit.trim();
    if (!unit) continue;
    if (unit.length > FOLLOWING_CHUNK_MAX_CHARS) {
      pushCurrent();
      for (let offset = 0; offset < unit.length; offset += FOLLOWING_CHUNK_MAX_CHARS) {
        chunks.push(unit.slice(offset, offset + FOLLOWING_CHUNK_MAX_CHARS).trim());
      }
      continue;
    }
    if (current && current.length + unit.length > FOLLOWING_CHUNK_MAX_CHARS) pushCurrent();
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
