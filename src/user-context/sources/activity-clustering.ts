import { createHash } from 'node:crypto';

import type { UnderstandingSourceItem, UserFocus } from './types.js';

const STOP_WORDS = new Set([
  'about', 'and', 'bookmark', 'bookmarks', 'desktop', 'document', 'documents', 'download', 'downloads',
  'file', 'files', 'from', 'guide', 'home', 'index', 'into', 'latest', 'new', 'notes', 'official', 'overview',
  'page', 'plan', 'profile', 'project', 'recent', 'roadmap', 'the', 'this', 'with', 'www',
]);

export type ActivityTopic = Pick<UserFocus,
  'canonicalKey' | 'title' | 'summary' | 'horizon' | 'confidence' | 'evidenceRefs'> & {
    sourceIds: string[];
  };

type PreparedItem = {
  item: UnderstandingSourceItem;
  tokens: Set<string>;
  timestamp: number;
};

function activityTimestamp(item: UnderstandingSourceItem): number {
  return item.modifiedAt ?? item.occurredAt ?? item.startsAt ?? 0;
}

function tokenize(value: string): Set<string> {
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

function itemTokens(item: UnderstandingSourceItem): Set<string> {
  let host = '';
  if (item.resourceUri) {
    try { host = new URL(item.resourceUri).hostname.replace(/^www\./, ''); } catch { /* Ignore malformed sanitized locators. */ }
  }
  return tokenize([item.title, item.group ?? '', host].join(' '));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function related(left: PreparedItem, right: PreparedItem): boolean {
  const shared = overlap(left.tokens, right.tokens);
  if (shared >= 2) return true;
  const smallest = Math.min(left.tokens.size, right.tokens.size);
  if (shared === 1 && smallest <= 2) return true;
  return Boolean(shared === 1 && left.item.group && left.item.group === right.item.group);
}

function displayTitle(cluster: PreparedItem[]): string {
  const frequency = new Map<string, number>();
  for (const entry of cluster) for (const token of entry.tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  const shared = [...frequency.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([token]) => token);
  if (shared.length && shared.every((token) => /^[\p{Script=Han}]+$/u.test(token))) {
    return cluster[0]!.item.title.replace(/\.[a-z0-9]{1,8}$/i, '').slice(0, 80);
  }
  if (shared.length) return shared.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(' ');
  return cluster[0]!.item.title.replace(/\.[a-z0-9]{1,8}$/i, '').slice(0, 80);
}

export function clusterActivityTopics(items: UnderstandingSourceItem[], now = Date.now()): ActivityTopic[] {
  const prepared = items
    .filter((item) => item.type === 'document' || item.type === 'bookmark')
    .map((item) => ({ item, tokens: itemTokens(item), timestamp: activityTimestamp(item) }))
    .filter((entry) => entry.tokens.size > 0);
  const parent = prepared.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!));
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < prepared.length; left += 1) {
    for (let right = left + 1; right < prepared.length; right += 1) {
      if (related(prepared[left]!, prepared[right]!)) union(left, right);
    }
  }
  const clusters = new Map<number, PreparedItem[]>();
  prepared.forEach((entry, index) => clusters.set(find(index), [...(clusters.get(find(index)) ?? []), entry]));
  return [...clusters.values()].flatMap((cluster): ActivityTopic[] => {
    if (cluster.length < 2) return [];
    const sourceIds = [...new Set(cluster.map(({ item }) => item.sourceId))];
    const types = new Set(cluster.map(({ item }) => item.type));
    if (types.size === 1 && types.has('bookmark') && cluster.length < 3) return [];
    const newestAt = Math.max(...cluster.map(({ timestamp }) => timestamp));
    const ageDays = newestAt ? Math.max(0, (now - newestAt) / 86_400_000) : 90;
    const recency = Math.max(0, 1 - ageDays / 90);
    const confidence = Math.min(0.92, 0.48 + Math.min(cluster.length, 5) * 0.06 + Math.min(sourceIds.length, 3) * 0.09 + recency * 0.08);
    const title = displayTitle(cluster);
    const fileCount = cluster.filter(({ item }) => item.type === 'document').length;
    const bookmarkCount = cluster.length - fileCount;
    const evidenceRefs = cluster.map(({ item }) => item.evidenceRef);
    const sharedTokens = new Map<string, number>();
    for (const entry of cluster) for (const token of entry.tokens) sharedTokens.set(token, (sharedTokens.get(token) ?? 0) + 1);
    const stableTopicTokens = [...sharedTokens.entries()].filter(([, count]) => count >= 2).map(([token]) => token).sort();
    const key = createHash('sha256').update(stableTopicTokens.join('|')).digest('hex').slice(0, 16);
    const signals = [fileCount ? `${fileCount} recent file${fileCount === 1 ? '' : 's'}` : '', bookmarkCount ? `${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
    return [{
      canonicalKey: `activity-focus:${key}`,
      title,
      summary: `${signals} suggest sustained attention to ${title}.`,
      horizon: ageDays <= 14 ? 'current' : 'ongoing',
      confidence,
      evidenceRefs,
      sourceIds,
    }];
  }).sort((left, right) => right.confidence - left.confidence).slice(0, 5);
}
