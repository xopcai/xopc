import type { Message, MessageContent } from '@/features/chat/messages.types';

const MAX_ASSISTANT_CHARS = 1200;

function collectAssistantPlainText(content: MessageContent[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'text' && b.text?.trim()) {
      parts.push(b.text.trim());
    }
  }
  return parts.join('\n').trim();
}

/**
 * Cheap follow-up prompts after an assistant turn (no extra LLM call).
 * Keeps suggestions short for chip UI.
 */
export function suggestFollowUpsFromAssistantMessage(msg: Message): string[] {
  if (msg.role !== 'assistant') return [];
  const raw = collectAssistantPlainText(msg.content);
  if (!raw) return [];
  const slice = raw.length > MAX_ASSISTANT_CHARS ? `${raw.slice(0, MAX_ASSISTANT_CHARS)}…` : raw;
  const lower = slice.toLowerCase();

  const out: string[] = [];

  if (/\b(function|class|const |def |import |export )\b/.test(lower) || /```/.test(slice)) {
    out.push('Add error handling and edge cases.');
    out.push('Refactor for readability.');
  } else if (/\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december/i.test(slice)) {
    out.push('Give a shorter summary.');
    out.push('What are the main risks?');
  } else {
    out.push('Explain that in simpler terms.');
    out.push('Give a concrete example.');
  }

  out.push('What should I do next?');

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of out) {
    const k = s.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    deduped.push(k);
    if (deduped.length >= 4) break;
  }
  return deduped.slice(0, 4);
}
