import { createHash } from 'node:crypto';

const STOP_WORDS = new Set([
  'about', 'and', 'bookmark', 'bookmarks', 'desktop', 'document', 'documents', 'download', 'downloads',
  'file', 'files', 'from', 'fwd', 'guide', 'home', 'index', 'into', 'latest', 'new', 'notes', 'official',
  'overview', 'page', 'plan', 'profile', 'project', 'recent', 'reply', 'roadmap', 'the', 'this', 'with', 'www',
]);

export type UnderstandingSignal = {
  evidenceRef: string;
  sourceId: string;
  title: string;
  group?: string;
  subjectKey?: string;
  occurredAt?: number;
};

export type UnderstandingSignalCluster = {
  key: string;
  title: string;
  confidence: number;
  horizon: 'current' | 'ongoing';
  signals: UnderstandingSignal[];
  sourceIds: string[];
};

type PreparedSignal = {
  signal: UnderstandingSignal;
  tokens: Set<string>;
};

function normalizeKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || undefined;
}

export function tokenizeUnderstandingSignal(value: string): Set<string> {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/https?:\/\//g, ' ');
  const tokens = new Set<string>();
  for (const token of normalized.match(/[a-z0-9][a-z0-9-]{2,}|[\p{Script=Han}]{2,}/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length <= 4) tokens.add(token);
      else for (let index = 0; index < token.length - 1; index += 1) tokens.add(token.slice(index, index + 2));
      continue;
    }
    const clean = token.replace(/^-+|-+$/g, '');
    if (clean.length >= 3 && !STOP_WORDS.has(clean) && !/^\d+$/.test(clean)) tokens.add(clean);
  }
  return tokens;
}

function signalTokens(signal: UnderstandingSignal): Set<string> {
  return tokenizeUnderstandingSignal([signal.title, signal.group ?? ''].join(' '));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function related(left: PreparedSignal, right: PreparedSignal): boolean {
  const leftSubject = normalizeKey(left.signal.subjectKey);
  const rightSubject = normalizeKey(right.signal.subjectKey);
  if (leftSubject && leftSubject === rightSubject) return true;

  const shared = overlap(left.tokens, right.tokens);
  if (shared >= 2) return true;
  const smallest = Math.min(left.tokens.size, right.tokens.size);
  if (shared === 1 && smallest <= 2) return true;
  return Boolean(
    shared === 1
    && left.signal.group
    && normalizeKey(left.signal.group) === normalizeKey(right.signal.group),
  );
}

function displayTitle(cluster: PreparedSignal[]): string {
  const subjects = new Map<string, { count: number; label: string }>();
  for (const { signal } of cluster) {
    const key = normalizeKey(signal.subjectKey);
    if (!key) continue;
    const current = subjects.get(key);
    subjects.set(key, { count: (current?.count ?? 0) + 1, label: signal.subjectKey! });
  }
  const repeatedSubject = [...subjects.values()].sort((left, right) => right.count - left.count)[0];
  if (repeatedSubject && repeatedSubject.count >= 2) return repeatedSubject.label.slice(0, 80);

  const frequency = new Map<string, number>();
  for (const entry of cluster) for (const token of entry.tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  const shared = [...frequency.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([token]) => token);
  if (shared.length && !shared.every((token) => /^[\p{Script=Han}]+$/u.test(token))) {
    return shared.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(' ');
  }
  return cluster[0]!.signal.title.replace(/\.[a-z0-9]{1,8}$/i, '').slice(0, 80);
}

export function clusterUnderstandingSignals(
  signals: UnderstandingSignal[],
  now = Date.now(),
): UnderstandingSignalCluster[] {
  const prepared = signals
    .map((signal) => ({ signal, tokens: signalTokens(signal) }))
    .filter((entry) => entry.tokens.size > 0 || entry.signal.subjectKey);
  const parent = prepared.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!));
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < prepared.length; left += 1) {
    for (let right = left + 1; right < prepared.length; right += 1) {
      if (related(prepared[left]!, prepared[right]!)) union(left, right);
    }
  }

  const clusters = new Map<number, PreparedSignal[]>();
  prepared.forEach((entry, index) => clusters.set(find(index), [...(clusters.get(find(index)) ?? []), entry]));
  return [...clusters.values()].flatMap((cluster): UnderstandingSignalCluster[] => {
    if (cluster.length < 2) return [];
    const sourceIds = [...new Set(cluster.map(({ signal }) => signal.sourceId))];
    const timestamps = cluster.map(({ signal }) => signal.occurredAt ?? 0).filter(Boolean);
    const newestAt = timestamps.length ? Math.max(...timestamps) : 0;
    const ageDays = newestAt ? Math.max(0, (now - newestAt) / 86_400_000) : 90;
    const recency = Math.max(0, 1 - ageDays / 90);
    const confidence = Math.min(
      0.92,
      0.48 + Math.min(cluster.length, 5) * 0.06 + Math.min(sourceIds.length, 3) * 0.09 + recency * 0.08,
    );
    const tokenFrequency = new Map<string, number>();
    for (const entry of cluster) for (const token of entry.tokens) tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    const stableTokens = [...tokenFrequency.entries()]
      .filter(([, count]) => count >= 2)
      .map(([token]) => token)
      .sort();
    const stableSubjects = cluster
      .map(({ signal }) => normalizeKey(signal.subjectKey))
      .filter((value): value is string => Boolean(value))
      .sort();
    const keyMaterial = stableTokens.length ? stableTokens : stableSubjects;
    const key = createHash('sha256')
      .update((keyMaterial.length ? keyMaterial : cluster.map(({ signal }) => signal.evidenceRef).sort()).join('|'))
      .digest('hex')
      .slice(0, 16);
    return [{
      key,
      title: displayTitle(cluster),
      confidence,
      horizon: ageDays <= 14 ? 'current' : 'ongoing',
      signals: cluster.map(({ signal }) => signal),
      sourceIds,
    }];
  }).sort((left, right) => right.confidence - left.confidence);
}
