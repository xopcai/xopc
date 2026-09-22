export function chatSpeakableText(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '\n')
    .replace(/xopc-product-delivery:\S+/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '').replace(/[|`*_~>]/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function chatSpeechLanguage(text: string, fallback: string): string {
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return han === 0 && latin === 0 ? (fallback.startsWith('zh') ? 'zh-CN' : 'en-US') : han * 2 >= latin ? 'zh-CN' : 'en-US';
}

export function chatSpeechChunks(markdown: string): string[] {
  const units = chatSpeakableText(markdown).match(/[^。！？!?.\n]+[。！？!?.]?|\n+/g) || [];
  const chunks: string[] = [];
  let current = '';
  const split = (source: string, limit: number): void => {
    let rest = source;
    while (rest) {
      let end = Math.min(rest.length, limit);
      if (end < rest.length && rest.charCodeAt(end - 1) >= 0xD800 && rest.charCodeAt(end - 1) <= 0xDBFF) end--;
      const chunk = rest.slice(0, end).trim(); if (chunk) chunks.push(chunk);
      rest = rest.slice(end);
    }
  };
  split((units.shift() || '').trim(), 80);
  for (const raw of units) {
    const unit = raw.trim(); if (!unit) continue;
    if (unit.length > 240) {
      if (current.trim()) chunks.push(current.trim()); current = ''; split(unit, 240); continue;
    }
    if (current && current.length + unit.length > 240) { chunks.push(current.trim()); current = ''; }
    current += unit;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
