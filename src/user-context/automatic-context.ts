import { getUserProfile, listUnderstandings } from '../storage/sqlite/user-context-repository.js';
import { remoteContextEligibleIds, type RemoteContextKind } from '../storage/sqlite/remote-context-repository.js';
import type { UserContextScopeTarget } from './scope.js';
import { UserUnderstandingRetriever } from './retriever.js';
import { allowsAutomaticDisclosure, focusRejectionReason, focusScore, rejectionReason } from './selection-policy.js';
import { listUserFocuses } from './sources/repository.js';

export interface AutomaticContextReference {
  kind: RemoteContextKind | 'profile';
  id: string;
  version: string;
}

export interface AutomaticContextSelection {
  block: string;
  references: AutomaticContextReference[];
}

/** Read-only background selection. Never consumes consent or starts a model turn. */
export function selectAutomaticContext(input: UserContextScopeTarget & {
  query: string;
  maxChars: number;
  deadline: number;
}): AutomaticContextSelection {
  const references: AutomaticContextReference[] = [];
  const facts: Array<{ text: string; origin: string }> = [];
  const profile: Record<string, string> = {};
  const render = () => JSON.stringify({ backgroundMemory: { profile, facts } });
  const withinDeadline = () => performance.now() < input.deadline;
  if (input.maxChars < 128 || !withinDeadline()) return { block: '', references };
  const user = getUserProfile();
  for (const key of ['callName', 'locale', 'timezone', 'pronouns', 'role', 'primaryGoal'] as const) {
    if (!user[key] || user[key].length > 300) continue;
    profile[key] = user[key];
    if (render().length > input.maxChars) delete profile[key];
  }
  if (Object.keys(profile).length) references.push({ kind: 'profile', id: 'profile', version: JSON.stringify(user) });
  const query = input.query.trim();
  const candidates = !withinDeadline() ? [] : query
    ? new UserUnderstandingRetriever().retrieve({ ...input, maxCandidates: 50 })
    : listUnderstandings(['active'], undefined, 200)
      .filter((item) => item.explicitness === 'explicit' && ['preference', 'boundary'].includes(item.kind) && item.durability === 'durable')
      .map((understanding) => ({ understanding, score: 1 }));
  const now = Date.now();
  const eligible = candidates.filter(({ understanding: item, score }) => item.status === 'active'
    && allowsAutomaticDisclosure(item)
    && !rejectionReason(item, input, now, []) && score > 0.25);
  const allowed = withinDeadline() ? remoteContextEligibleIds('understanding', eligible.map(({ understanding }) => understanding.id)) : new Set<string>();
  const append = (text: string, origin: string, reference: AutomaticContextReference) => {
    if (!withinDeadline() || facts.length >= 6 || !text.trim()) return;
    facts.push({ text, origin });
    if (render().length > input.maxChars) { facts.pop(); return; }
    references.push(reference);
  };
  for (const { understanding: item } of eligible) {
    if (allowed.has(item.id)) append(item.statement, item.explicitness, { kind: 'understanding', id: item.id, version: item.versionId });
  }
  if (query && withinDeadline() && facts.length < 6) {
    const focuses = listUserFocuses(['active'], 50)
      .filter((item) => allowsAutomaticDisclosure(item) && !focusRejectionReason(item, input, now))
      .map((item) => ({ item, score: focusScore(item, query, input) }))
      .filter(({ score }) => score > 0.25).sort((a, b) => b.score - a.score);
    const allowedFocuses = remoteContextEligibleIds('focus', focuses.map(({ item }) => item.id));
    for (const { item } of focuses) {
      if (allowedFocuses.has(item.id)) append(`${item.title}: ${item.summary}`, item.explicitness,
        { kind: 'focus', id: item.id, version: item.versionId ?? String(item.updatedAt) });
    }
  }
  return { block: references.length ? render() : '', references };
}
