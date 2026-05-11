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

type FollowUpFamily = 'code' | 'web' | 'email' | 'date' | 'generic' | 'meta';

const ALL_IDS: readonly FollowUpSuggestionId[] = [
  'code_error_handling',
  'code_refactor',
  'code_explain',
  'code_optimize',
  'web_more_details',
  'web_find_sources',
  'date_shorter_summary',
  'date_main_risks',
  'email_make_formal',
  'email_shorten',
  'generic_simpler_terms',
  'generic_concrete_example',
  'generic_bullet_points',
  'generic_create_table',
  'what_next',
];

function familyOf(id: FollowUpSuggestionId): FollowUpFamily {
  if (id.startsWith('code_')) return 'code';
  if (id.startsWith('web_')) return 'web';
  if (id.startsWith('email_')) return 'email';
  if (id.startsWith('date_')) return 'date';
  if (id === 'what_next') return 'meta';
  return 'generic';
}

const BASE_FAMILY_MAX: Record<FollowUpFamily, number> = {
  code: 3,
  web: 2,
  email: 2,
  date: 2,
  generic: 3,
  meta: 1,
};

/** Tighten dominant families when several content types fire so mixed replies get mixed chips. */
function familyMaxForSignals(s: Signals): Record<FollowUpFamily, number> {
  const m = { ...BASE_FAMILY_MAX };
  if (s.code && s.web) m.code = Math.min(m.code, 2);
  if (s.code && s.email) m.code = Math.min(m.code, 2);
  if (s.code && s.date) m.code = Math.min(m.code, 2);
  if (s.web && s.email) {
    m.web = Math.min(m.web, 1);
    m.email = Math.min(m.email, 1);
  }
  return m;
}

export function followUpPromptForSuggestionId(id: FollowUpSuggestionId): string {
  const prompts: Record<FollowUpSuggestionId, string> = {
    code_error_handling:
      'Add error handling and edge cases for the code or approach you described.',
    code_refactor: 'Refactor that code for readability while preserving behavior.',
    code_explain: 'Explain that code step by step.',
    code_optimize: 'Suggest performance optimizations for that code.',
    web_more_details:
      'Search for more details online and summarize what you find in the context of this answer.',
    web_find_sources:
      'Find reliable primary or secondary sources online and cite them briefly.',
    date_shorter_summary: 'Give a shorter summary focusing on the key dates and outcomes.',
    date_main_risks: 'What are the main risks or unknowns related to this timeline or plan?',
    email_make_formal: 'Rewrite the email or message in a more formal professional tone.',
    email_shorten: 'Shorten the email or message while keeping the essential meaning.',
    generic_simpler_terms: 'Explain that again in simpler terms for a non-expert reader.',
    generic_concrete_example: 'Give a concrete example that illustrates the main idea.',
    generic_bullet_points: 'Summarize the answer as concise bullet points.',
    generic_create_table: 'Present the main structured information as a Markdown table.',
    what_next: 'What should I do next based on your answer?',
  };
  return prompts[id];
}

function collectAssistantPlainText(content: MessageContent[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'text' && b.text?.trim()) {
      parts.push(b.text.trim());
    }
  }
  return parts.join('\n').trim();
}

type Signals = {
  code: boolean;
  web: boolean;
  email: boolean;
  date: boolean;
  list: boolean;
  table: boolean;
  substantial: boolean;
};

function detectSignals(slice: string, lower: string): Signals {
  const code =
    /\b(function|class|const |def |import |export |async |await |interface |type |public |private |protected |#include|namespace )\b/.test(
      lower,
    ) ||
    /\b(return |if \(|for \(|while \(|\.map\(|\.filter\(|fn )\b/.test(lower) ||
    /```/.test(slice);

  const web =
    /https?:\/\//i.test(slice) ||
    /\bwww\.[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b/i.test(lower) ||
    /\[[^\]]+\]\([^)]+\)/.test(slice) ||
    /\bRFC\s*\d+/i.test(slice) ||
    /\bdocs?\.[a-z0-9.-]+\.[a-z]{2,}\b/i.test(lower) ||
    /wikipedia\.org/i.test(lower) ||
    /参考文献|参考链接|资料来源|来源[:：]|\bsee also\b|\bread more\b/i.test(slice);

  const email =
    /(^|\n)\s*dear\b[\s,]/im.test(slice) ||
    /best regards|kind regards|sincerely|yours truly|yours sincerely|此致|敬礼|敬上|顺祝|商祺|尊敬的|顺颂|台安/i.test(
      slice,
    ) ||
    /(^|\n)\s*(from|to|cc|bcc)\s*:\s*\S/im.test(slice) ||
    /(^|\n)\s*subject\s*:\s*\S/im.test(slice) ||
    /(^|\n)>\s*On .+wrote:/im.test(slice) ||
    /\b(email|e-mail)\s+(to|from)\b/i.test(lower);

  const date =
    /\d{4}-\d{2}-\d{2}/.test(slice) ||
    /\d{4}年\d{1,2}月/.test(slice) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      slice,
    ) ||
    /q[1-4]\b|\bquarter\b|本季度|上周|本周|下周|昨天|今天|明天|deadline|timeline/i.test(slice);

  const list = /^[-*•]|\n[-*•]|\n\d+\.\s/.test(slice.trim());
  const table = /\|[^\n]+\|[^\n]+\|/.test(slice);
  const substantial = slice.length > 80;

  return { code, web, email, date, list, table, substantial };
}

function scoreIds(s: Signals): Map<FollowUpSuggestionId, number> {
  const m = new Map<FollowUpSuggestionId, number>();
  for (const id of ALL_IDS) m.set(id, 0);

  const add = (id: FollowUpSuggestionId, v: number) => m.set(id, (m.get(id) ?? 0) + v);

  if (s.code) {
    add('code_error_handling', 52);
    add('code_explain', 51);
    add('code_refactor', 50);
    add('code_optimize', 49);
  }
  if (s.web) {
    add('web_more_details', 48);
    add('web_find_sources', 47);
  }
  if (s.email) {
    add('email_make_formal', 46);
    add('email_shorten', 45);
  }
  if (s.date) {
    add('date_shorter_summary', 44);
    add('date_main_risks', 43);
  }

  if (s.list) {
    add('generic_bullet_points', 28);
    add('generic_create_table', 26);
    add('generic_simpler_terms', 18);
  }
  if (s.table) {
    add('generic_bullet_points', 22);
    add('generic_simpler_terms', 20);
    add('generic_create_table', 16);
  }

  if (s.substantial) {
    add('generic_simpler_terms', 14);
    add('generic_concrete_example', 12);
    add('generic_bullet_points', 10);
  } else {
    add('generic_simpler_terms', 8);
    add('generic_concrete_example', 6);
  }

  // Slight boost when nothing else matched so chips stay useful.
  if (!s.code && !s.web && !s.email && !s.date && !s.list && !s.table) {
    add('generic_concrete_example', 6);
  }

  add('what_next', 40);

  // Down-rank generic prompts when the reply is strongly code-centric (family caps still allow one generic).
  if (s.code && !s.web && !s.email) {
    for (const id of ALL_IDS) {
      if (id.startsWith('generic_')) m.set(id, (m.get(id) ?? 0) * 0.55);
    }
  }

  return m;
}

function selectFollowUps(
  scores: Map<FollowUpSuggestionId, number>,
  signals: Signals,
): FollowUpSuggestionId[] {
  const ranked = [...ALL_IDS].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
  const familyMax = familyMaxForSignals(signals);

  const familyUsed: Record<FollowUpFamily, number> = {
    code: 0,
    web: 0,
    email: 0,
    date: 0,
    generic: 0,
    meta: 0,
  };
  const picked: FollowUpSuggestionId[] = [];
  const pickedSet = new Set<FollowUpSuggestionId>();

  const tryPick = (id: FollowUpSuggestionId): boolean => {
    if (picked.length >= 4 || pickedSet.has(id)) return false;
    const fam = familyOf(id);
    if (familyUsed[fam] >= familyMax[fam]) return false;
    picked.push(id);
    pickedSet.add(id);
    familyUsed[fam] += 1;
    return true;
  };

  const nonWhatNext = ranked.filter((id) => id !== 'what_next');
  for (const id of nonWhatNext) {
    if (picked.length >= 3) break;
    tryPick(id);
  }

  if (!pickedSet.has('what_next')) tryPick('what_next');

  for (const id of nonWhatNext) {
    if (picked.length >= 4) break;
    tryPick(id);
  }

  // Prefer "what next" last in the row when both appear.
  const metaIdx = picked.indexOf('what_next');
  if (metaIdx >= 0 && metaIdx < picked.length - 1) {
    const [wn] = picked.splice(metaIdx, 1);
    picked.push(wn);
  }

  return picked.slice(0, 4);
}

/**
 * Cheap follow-up prompts after an assistant turn (no extra LLM call).
 * Returns stable ids for chip UI; translate via i18n at render time.
 * Send text for the model: {@link followUpPromptForSuggestionId}.
 */
export function suggestFollowUpsFromAssistantMessage(msg: Message): FollowUpSuggestionId[] {
  if (msg.role !== 'assistant') return [];
  const raw = collectAssistantPlainText(msg.content);
  if (!raw) return [];
  const slice = raw.length > MAX_ASSISTANT_CHARS ? `${raw.slice(0, MAX_ASSISTANT_CHARS)}…` : raw;
  const lower = slice.toLowerCase();

  const signals = detectSignals(slice, lower);
  const scores = scoreIds(signals);
  return selectFollowUps(scores, signals);
}
