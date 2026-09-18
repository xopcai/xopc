import { markdownToIR } from '../markdown/index.js';

export function markdownNotificationPreview(markdown: string, maxCharacters: number): string {
  const plainText = markdownToIR(markdown, {
    enableSpoilers: true,
    linkify: true,
    tableMode: 'bullets',
  }).text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(plainText);
  return characters.length > maxCharacters
    ? `${characters.slice(0, Math.max(0, maxCharacters - 1)).join('')}…`
    : plainText;
}
