import { buildSpeakableText } from '@/features/voice/read-aloud-text';

/** Read the complete preview, including fenced text, without attachment addresses. */
export function buildNoteReadAloudText(title: string, markdown: string): string {
  const body = buildSpeakableText(markdown
    .replace(/^\s*(`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/xopc-attachment:\/\/[^\s)]+/g, '')
    .replace(/^(\s*[-*+]\s+)\[[ xX]\]\s*/gm, '$1'));
  const heading = buildSpeakableText(title);
  if (!heading || body.split('\n')[0] === heading) return body;
  return [heading, body].filter(Boolean).join('\n\n');
}
