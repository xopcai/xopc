import type { Message, MessageContent } from '@/features/chat/messages.types';

const MAX_ASSISTANT_CHARS = 1200;

/** Stable ids; labels come from i18n (`messages.chat.followUpChip*`). */
export type FollowUpSuggestionId =
  | 'code_error_handling'
  | 'code_refactor'
  | 'code_explain'
  | 'code_optimize'
  | 'web_more_details'
  | 'web_find_sources'
  | 'date_shorter_summary'
  | 'date_main_risks'
  | 'email_make_formal'
  | 'email_shorten'
  | 'generic_simpler_terms'
  | 'generic_concrete_example'
  | 'generic_bullet_points'
  | 'generic_create_table'
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

  // Code detection
  if (/\b(function|class|const |def |import |export |async |await |interface |type )\b/.test(lower) || /```/.test(slice)) {
    out.push('code_error_handling');
    out.push('code_explain');
    out.push('code_refactor');
    out.push('code_optimize');
  }
  // Date/timeline content
  else if (/\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|quarter/i.test(slice)) {
    out.push('date_shorter_summary');
    out.push('date_main_risks');
  }
  // List content (already bulleted)
  else if (/^[-*•]|\n[-*•]/.test(slice.trim())) {
    out.push('generic_simpler_terms');
    out.push('generic_create_table');
    out.push('generic_bullet_points');
  }
  // Table content detected
  else if (/\|.*\|.*\|/.test(slice)) {
    out.push('generic_simpler_terms');
    out.push('generic_bullet_points');
  }
  // Default/generic content
  else {
    out.push('generic_simpler_terms');
    out.push('generic_concrete_example');
    out.push('generic_bullet_points');
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
