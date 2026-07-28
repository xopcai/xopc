export type NativeMarkdownMessage =
  | { type: 'ready'; markdown?: string; [key: string]: unknown }
  | {
      type: 'content';
      markdown: string;
      reason?: 'typing' | 'command' | 'flush' | 'sync';
      flushRequestId?: number | null;
      [key: string]: unknown;
    };

export type NativeMarkdownSyncDecision =
  | { type: 'accept'; markdown: string }
  | { type: 'acknowledge'; markdown: string }
  | { type: 'resync'; markdown: string };

export type NativeMarkdownBlock = string | {
  text: string;
  paragraph?: boolean;
};

export type NativeCodeFenceOpening = {
  marker: string;
  language: string;
};

export const NATIVE_CODE_FENCE_HELPERS_SCRIPT = [
  'function parseNativeCodeFenceOpening(line) {',
  '  var match = /^(`{3,}|~{3,})([^`~]*)$/.exec(String(line || "").trim());',
  '  return match ? { marker: match[1], language: String(match[2] || "").trim() } : null;',
  '}',
  'function isNativeCodeFenceClosing(line, openingMarker) {',
  '  var marker = String(openingMarker || "```");',
  '  var match = (marker.charAt(0) === "~" ? /^(~{3,})\\s*$/ : /^(`{3,})\\s*$/).exec(String(line || "").trim());',
  '  return !!(match && match[1].length >= marker.length);',
  '}',
  'function serializeNativeCodeFence(language, content) {',
  '  var value = String(content || "");',
  '  var runs = value.match(/`+/g) || [];',
  '  var markerLength = 3;',
  '  for (var i = 0; i < runs.length; i += 1) markerLength = Math.max(markerLength, runs[i].length + 1);',
  '  var marker = new Array(markerLength + 1).join("`");',
  '  var safeLanguage = String(language || "").replace(/`/g, "").trim();',
  '  return marker + safeLanguage + "\\n" + value + "\\n" + marker;',
  '}',
].join('\n');

export const NATIVE_INDENTED_BLOCK_HELPERS_SCRIPT = [
  'function isNativeIndentedListLine(line) {',
  '  return /^\\s+(?:[-*]|\\d+\\.)(?:\\s|$)/.test(String(line || ""));',
  '}',
].join('\n');

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

export function parseNativeCodeFenceOpening(line: string): NativeCodeFenceOpening | null {
  const match = /^(`{3,}|~{3,})([^`~]*)$/.exec(line.trim());
  return match ? { marker: match[1]!, language: String(match[2] || '').trim() } : null;
}

export function isNativeCodeFenceClosing(line: string, openingMarker: string): boolean {
  const marker = openingMarker || '```';
  const match = (marker.startsWith('~') ? /^(~{3,})\s*$/ : /^(`{3,})\s*$/).exec(line.trim());
  return Boolean(match && match[1]!.length >= marker.length);
}

export function serializeNativeCodeFence(language: string, content: string): string {
  const runs = content.match(/`+/g) ?? [];
  let markerLength = 3;
  for (const run of runs) markerLength = Math.max(markerLength, run.length + 1);
  const marker = '`'.repeat(markerLength);
  const safeLanguage = language.replace(/`/g, '').trim();
  return `${marker}${safeLanguage}\n${content}\n${marker}`;
}

export function isNativeIndentedListLine(line: string): boolean {
  return /^\s+(?:[-*]|\d+\.)(?:\s|$)/.test(line);
}

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
  return decideNativeMarkdownMessage(message, currentMarkdown).type === 'accept';
}

export function decideNativeMarkdownMessage(
  message: NativeMarkdownMessage,
  currentMarkdown: string,
): NativeMarkdownSyncDecision {
  if (message.type === 'ready') {
    return message.markdown === currentMarkdown
      ? { type: 'acknowledge', markdown: currentMarkdown }
      : { type: 'resync', markdown: currentMarkdown };
  }
  if (message.reason === 'sync') {
    return message.markdown === currentMarkdown
      ? { type: 'acknowledge', markdown: currentMarkdown }
      : { type: 'resync', markdown: currentMarkdown };
  }
  return message.markdown === currentMarkdown
    ? { type: 'acknowledge', markdown: currentMarkdown }
    : { type: 'accept', markdown: message.markdown };
}

export function isNativeMarkdownFlushResponse(message: NativeMarkdownMessage, requestId: number): boolean {
  return message.type === 'content' && message.flushRequestId === requestId;
}
