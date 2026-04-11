import type { Message, MessageContent } from '@/features/chat/messages.types';

const MAX_ASSISTANT_CHARS = 1200;

/** Stable ids; labels come from i18n (`messages.chat.followUpChip*`). */
export type FollowUpSuggestionId =
  | 'code_error_handling'
  | 'code_refactor'
  | 'date_shorter_summary'
  | 'date_main_risks'
  | 'generic_simpler_terms'
  | 'generic_concrete_example'
  | 'what_next';

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
 * Returns stable ids for chip UI; translate via i18n at render time.
 */
export function suggestFollowUpsFromAssistantMessage(msg: Message): FollowUpSuggestionId[] {
  if (msg.role !== 'assistant') return [];
  const raw = collectAssistantPlainText(msg.content);
  if (!raw) return [];
  const slice = raw.length > MAX_ASSISTANT_CHARS ? `${raw.slice(0, MAX_ASSISTANT_CHARS)}…` : raw;
  const lower = slice.toLowerCase();

  const out: FollowUpSuggestionId[] = [];

  if (/\b(function|class|const |def |import |export )\b/.test(lower) || /```/.test(slice)) {
    out.push('code_error_handling');
    out.push('code_refactor');
  } else if (/\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december/i.test(slice)) {
    out.push('date_shorter_summary');
    out.push('date_main_risks');
  } else {
    out.push('generic_simpler_terms');
    out.push('generic_concrete_example');
  }

  out.push('what_next');

  const seen = new Set<FollowUpSuggestionId>();
  const deduped: FollowUpSuggestionId[] = [];
  for (const s of out) {
    if (seen.has(s)) continue;
    seen.add(s);
    deduped.push(s);
    if (deduped.length >= 4) break;
  }
  return deduped.slice(0, 4);
}
