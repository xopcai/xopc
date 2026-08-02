import type { KnowledgeSourceItem } from '../knowledge/types.js';
import { listKnowledgeSourceItems } from '../storage/sqlite/knowledge-repository.js';

import type { FocusCalendarSignal, FocusView } from './types.js';

const LOOKAHEAD_MS = 7 * 86_400_000;
const FIELD_LIMIT = 8;
const TITLE_KEYS = new Set(['summary', 'title', 'name', 'subject']);
const DESCRIPTION_KEYS = new Set(['description', 'notes', 'body', 'agenda']);
const START_KEYS = new Set(['start', 'starttime', 'start_time', 'startat', 'start_at', 'datetime']);
const END_KEYS = new Set(['end', 'endtime', 'end_time', 'endat', 'end_at']);
const STOP_WORDS = new Set(['about', 'after', 'before', 'from', 'have', 'meeting', 'project', 'review', 'the', 'this', 'with']);

function parsePayload(item: KnowledgeSourceItem): unknown {
  if (!item.normalizedText) return null;
  try {
    return JSON.parse(item.normalizedText);
  } catch {
    return null;
  }
}

function findStrings(value: unknown, keys: Set<string>, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => findStrings(item, keys, depth + 1)).slice(0, FIELD_LIMIT);
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const direct = Object.entries(record).flatMap(([key, nested]) => {
    if (!keys.has(key.toLowerCase().replaceAll('-', '_'))) return [];
    if (typeof nested === 'string') return [nested];
    return findStrings(nested, new Set(['datetime', 'date', 'value']), depth + 1);
  });
  if (direct.length > 0) return direct.slice(0, FIELD_LIMIT);
  return Object.values(record).flatMap((nested) => findStrings(nested, keys, depth + 1)).slice(0, FIELD_LIMIT);
}

function firstDate(payload: unknown, keys: Set<string>): number | undefined {
  for (const value of findStrings(payload, keys)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function terms(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase();
  const result = new Set(normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((word) => !STOP_WORDS.has(word)) ?? []);
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) result.add(sequence.slice(index, index + 2));
  }
  return result;
}

function relatedFocus(focuses: FocusView[], text: string): FocusView | undefined {
  const eventTerms = terms(text);
  if (eventTerms.size === 0) return undefined;
  return focuses
    .map((focus) => ({ focus, score: [...terms(`${focus.title} ${focus.summary}`)].filter((term) => eventTerms.has(term)).length }))
    .filter((candidate) => candidate.score >= 2)
    .toSorted((left, right) => right.score - left.score || right.focus.focusScore - left.focus.focusScore)[0]?.focus;
}

export function buildFocusCalendarSignals(
  items: KnowledgeSourceItem[],
  focuses: FocusView[],
  nowMs = Date.now(),
): FocusCalendarSignal[] {
  const end = nowMs + LOOKAHEAD_MS;
  const signals = items.flatMap((item): FocusCalendarSignal[] => {
    if (item.itemType !== 'calendar_event') return [];
    const payload = parsePayload(item);
    const title = findStrings(payload, TITLE_KEYS)[0]?.trim();
    const startsAt = firstDate(payload, START_KEYS);
    if (!title || startsAt == null || startsAt < nowMs || startsAt > end) return [];
    const description = findStrings(payload, DESCRIPTION_KEYS).join(' ');
    const focus = relatedFocus(focuses, `${title} ${description}`);
    if (!focus) return [];
    const endsAt = firstDate(payload, END_KEYS);
    return [{
      id: item.id,
      focusId: focus.id,
      focusTitle: focus.title,
      title,
      startsAt,
      ...(endsAt != null ? { endsAt } : {}),
      sourceInstanceId: item.sourceInstanceId,
    }];
  }).toSorted((left, right) => left.startsAt - right.startsAt);
  return signals.filter((signal, index) => signals.findIndex((candidate) => (
    candidate.focusId === signal.focusId
    && candidate.startsAt === signal.startsAt
    && candidate.title.toLocaleLowerCase() === signal.title.toLocaleLowerCase()
  )) === index).slice(0, 20);
}

export function listFocusCalendarSignals(focuses: FocusView[], nowMs = Date.now()): FocusCalendarSignal[] {
  return buildFocusCalendarSignals(listKnowledgeSourceItems({ itemType: 'calendar_event', limit: 500 }), focuses, nowMs);
}
