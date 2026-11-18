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
  let rest = chatSpeakableText(markdown);
  let limit = 160;
  const chunks: string[] = [];
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let end = lastSpeechBreak(window, /[。！？!?]+["'”’」』）)]*|\.+["'”’」』）)]*(?=\s)|\n+/g, limit)
      || lastSpeechBreak(window, /[，、；：]|[,;:](?=\s)/g, limit)
      || lastSpeechBreak(window, /\s/g, limit)
      || limit;
    if (rest.charCodeAt(end - 1) >= 0xD800 && rest.charCodeAt(end - 1) <= 0xDBFF) end--;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
    limit = 420;
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function lastSpeechBreak(window: string, pattern: RegExp, limit: number): number {
  let end = 0;
  let match = pattern.exec(window);
  while (match) {
    const boundary = match.index + match[0].length;
    if (boundary <= limit && boundary >= Math.floor(limit / 2)) end = boundary;
    match = pattern.exec(window);
  }
  return end;
}
