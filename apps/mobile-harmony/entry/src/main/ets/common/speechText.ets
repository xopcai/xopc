export function chatSpeechChunks(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[\s#>*-]+/gm, '').replace(/[*_`]/g, '').trim();
  const chunks: string[] = [];
  let rest = text;
  while (rest) {
    let end = Math.min(rest.length, 1200);
    if (end < rest.length) {
      const boundary = Math.max(rest.lastIndexOf('\n', end), rest.lastIndexOf('。', end), rest.lastIndexOf('. ', end), rest.lastIndexOf(' ', end));
      if (boundary > 300) end = boundary + 1;
      if (rest.charCodeAt(end - 1) >= 0xD800 && rest.charCodeAt(end - 1) <= 0xDBFF) end--;
    }
    const chunk = rest.slice(0, end).trim(); if (chunk) chunks.push(chunk);
    rest = rest.slice(end).trim();
  }
  return chunks;
}
