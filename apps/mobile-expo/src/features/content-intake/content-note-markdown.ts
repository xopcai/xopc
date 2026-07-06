import type { ContentIntakeIntent } from './content-intent';

const FENCED_CODE_PATTERN = /^```[\s\S]*```$/;
const URL_PATTERN = /^https?:\/\/[^\s<>)"']+$/i;

export function buildContentIntakeNoteMarkdown(text: string, intent: ContentIntakeIntent): string {
  const trimmed = text.trim();
  if (intent.type === 'url') return buildUrlMarkdown(trimmed);
  if (intent.type === 'todo') return buildChecklistMarkdown(trimmed);
  if (intent.type !== 'code' || FENCED_CODE_PATTERN.test(trimmed)) return trimmed;
  return `\`\`\`\n${trimmed}\n\`\`\``;
}

function buildUrlMarkdown(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 2 || !URL_PATTERN.test(lines[1]) || URL_PATTERN.test(lines[0])) return text;
  return `[${escapeMarkdownLinkText(lines[0])}](${lines[1]})`;
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[[\]\\]/g, '\\$&');
}

function buildChecklistMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => normalizeChecklistLine(line))
    .join('\n');
}

function normalizeChecklistLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const checkbox = trimmed.match(/^[-*]?\s*\[([ xX]?)\]\s+(.+)$/);
  if (checkbox) {
    const checked = checkbox[1]?.toLowerCase() === 'x' ? 'x' : ' ';
    return `- [${checked}] ${checkbox[2].trim()}`;
  }
  const bullet = trimmed.match(/^[-*]\s+(.+)$/);
  if (bullet) return `- [ ] ${bullet[1].trim()}`;
  return `- [ ] ${trimmed.replace(/^todo:\s*/i, '').trim()}`;
}
