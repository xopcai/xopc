export type NativeMarkdownMessage =
  | { type: 'ready'; markdown?: string; [key: string]: unknown }
  | { type: 'content'; markdown: string; flushRequestId?: number | null; [key: string]: unknown };

export type NativeMarkdownBlock = string | {
  text: string;
  paragraph?: boolean;
};

export const NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT = [
  'function joinNativeMarkdownBlocks(parts) {',
  '  var next = parts.slice();',
  '  var blockText = function (part) { return typeof part === "string" ? part : String((part && part.text) || ""); };',
  '  var blockParagraph = function (part) { return typeof part !== "string" && !!(part && part.paragraph); };',
  "  while (next.length > 0 && !blockText(next[0]).trim()) next.shift();",
  "  while (next.length > 0 && !blockText(next[next.length - 1]).trim()) next.pop();",
  "  if (!next.length) return '';",
  '  var out = blockText(next[0]);',
  '  for (var i = 1; i < next.length; i += 1) {',
  '    var previous = next[i - 1];',
  '    var current = next[i];',
  '    var separator = blockParagraph(previous) && blockParagraph(current) ? "\\n\\n" : "\\n";',
  '    out += separator + blockText(current);',
  '  }',
  '  return out;',
  '}',
].join('\n');

export function joinNativeMarkdownBlocks(parts: NativeMarkdownBlock[]): string {
  const next = [...parts];
  const blockText = (part: NativeMarkdownBlock) => (typeof part === 'string' ? part : String(part.text || ''));
  const blockParagraph = (part: NativeMarkdownBlock) => typeof part !== 'string' && Boolean(part.paragraph);
  while (next.length > 0 && !blockText(next[0]!).trim()) next.shift();
  while (next.length > 0 && !blockText(next[next.length - 1]!).trim()) next.pop();
  if (!next.length) return '';
  let out = blockText(next[0]!);
  for (let i = 1; i < next.length; i += 1) {
    const previous = next[i - 1]!;
    const current = next[i]!;
    const separator = blockParagraph(previous) && blockParagraph(current) ? '\n\n' : '\n';
    out += separator + blockText(current);
  }
  return out;
}

export function shouldForwardNativeMarkdownMessage(message: NativeMarkdownMessage, currentMarkdown: string): boolean {
  return message.type === 'content' && message.markdown !== currentMarkdown;
}

export function isNativeMarkdownFlushResponse(message: NativeMarkdownMessage, requestId: number): boolean {
  return message.type === 'content' && message.flushRequestId === requestId;
}
