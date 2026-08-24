import { describe, expect, it } from 'vitest';

import { clusterActivityTopics } from '../activity-clustering.js';
import type { UnderstandingSourceItem } from '../types.js';

const now = Date.UTC(2026, 7, 23);

function item(overrides: Partial<UnderstandingSourceItem> & Pick<UnderstandingSourceItem, 'id' | 'title' | 'evidenceRef'>): UnderstandingSourceItem {
  return {
    sourceId: 'local-recent-files',
    type: 'document',
    modifiedAt: now - 86_400_000,
    ownerAttribution: 'user',
    sensitivity: 'personal',
    ...overrides,
  };
}

describe('clusterActivityTopics', () => {
  it('combines related file and bookmark metadata with exact evidence', () => {
    const topics = clusterActivityTopics([
      item({ id: '1', title: 'Acme launch brief.pdf', evidenceRef: 'local-recent-files://1' }),
      item({ id: '2', sourceId: 'chromium-bookmarks', type: 'bookmark', title: 'Acme launch metrics', resourceUri: 'https://analytics.example', evidenceRef: 'chromium-bookmarks://2' }),
      item({ id: '3', title: 'Unrelated tax receipt.pdf', evidenceRef: 'local-recent-files://3' }),
    ], now);

    expect(topics).toHaveLength(1);
    expect(topics[0]?.title).toContain('Acme');
    expect(topics[0]?.sourceIds).toEqual(['local-recent-files', 'chromium-bookmarks']);
    expect(topics[0]?.evidenceRefs).toEqual(['local-recent-files://1', 'chromium-bookmarks://2']);
    expect(topics[0]?.confidence).toBeGreaterThan(0.7);
  });

  it('drops singletons and weak two-bookmark coincidences', () => {
    const topics = clusterActivityTopics([
      item({ id: '1', title: 'Design systems', evidenceRef: 'local-recent-files://1' }),
      item({ id: '2', sourceId: 'chromium-bookmarks', type: 'bookmark', title: 'Rust language book', evidenceRef: 'chromium-bookmarks://2' }),
      item({ id: '3', sourceId: 'chromium-bookmarks', type: 'bookmark', title: 'Rust language guide', evidenceRef: 'chromium-bookmarks://3' }),
    ], now);

    expect(topics).toEqual([]);
  });

  it('returns every supported topic instead of truncating the ranked list', () => {
    const topics = clusterActivityTopics(Array.from({ length: 6 }, (_, topicIndex) => [
      item({
        id: `${topicIndex}-a`,
        title: `Unique${topicIndex} Alpha${topicIndex}`,
        evidenceRef: `local-recent-files://${topicIndex}-a`,
      }),
      item({
        id: `${topicIndex}-b`,
        title: `Unique${topicIndex} Alpha${topicIndex}`,
        evidenceRef: `local-recent-files://${topicIndex}-b`,
      }),
    ]).flat(), now);

    expect(topics).toHaveLength(6);
  });
});
