/** File delivery belongs to structured artifacts, not model-authored host links. */
function localTarget(value: string): boolean {
  let target = value.trim().replace(/^<|>$/g, '').replace(/\\([\\/])/g, '$1');
  try { target = decodeURIComponent(target); } catch { /* Inspect malformed targets as written. */ }
  return /^(?:\/|\\\\|~\/|\.\.?\/|[a-z]:[\\/]|file:|media:|xopc:\/\/workspace\/file)/i.test(target)
    || /^[^\s:?#]+\.(?:md|pdf|docx?|xlsx?|csv|pptx?|zip|png|jpe?g|webp|mp[34]|wav)(?:[?#].*)?$/i.test(target);
}

function cleanSegment(text: string): string {
  return text
    .replace(/^\s*MEDIA\s*:\s*.*$/gim, '')
    .replace(/!?\[([^\]\n]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g,
      (match, label: string, target: string) => localTarget(target) ? label : match)
    .replace(/^\s*\[[^\]\n]+\]:\s*(<[^>]+>|\S+).*$/gm,
      (match, target: string) => localTarget(target) ? '' : match)
    .replace(/<([^<>\n]+)>/g, (match, target: string) => localTarget(target) ? '' : match)
    .replace(/\b(?:file:\/\/|media:\/\/|xopc:\/\/workspace\/file)[^\s<>"'`]+/gi, '')
    .replace(/(?<![\w:/])(?:\/(?:Users|home|tmp|private|workspace|var)\/|[a-z]:[\\/])[^\s<>"'`]+/gi, '');
}

/** Preserve literal code; remove actionable local file references from prose. */
export function sanitizePersonalResultFileLinks(text: string): string {
  return text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g)
    .map((part, index) => index % 2 ? part : cleanSegment(part)).join('').trim();
}

export function hasPersonalResultFileLinks(text: string): boolean {
  return sanitizePersonalResultFileLinks(text) !== text.trim();
}
