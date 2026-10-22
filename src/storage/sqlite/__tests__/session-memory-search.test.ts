import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../index.js';
import { ensureSessionRecord, listSessionMetadata } from '../session-repository.js';
import { appendTranscriptEntry, searchSessionTranscript } from '../transcript-repository.js';

describe('session keyword search contract', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  function seed(text: string) {
    const id = randomUUID();
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat' });
    appendTranscriptEntry(id, { role: 'user', content: text, timestamp: 1700000000000 });
    return id;
  }
  it('returns actual text, identity and time for multi-keyword candidates, with explicit phrase mode', () => {
    const id = seed('青禾选择 SQLite，因为需要离线运行。');
    const query = '青禾 storage SQLite';
    expect(listSessionMetadata({ search: query }).items.map(row => row.key)).toContain(id);
    expect(searchSessionTranscript(id, query, { matchMode: 'keyword' })[0]).toMatchObject({ content: '青禾选择 SQLite，因为需要离线运行。', role: 'user' });
    expect(searchSessionTranscript(id, query, { matchMode: 'keyword' })[0].entryId).toBeTruthy();
    expect(searchSessionTranscript(id, query, { matchMode: 'keyword' })[0].createdAt).toBeGreaterThan(0);
    expect(searchSessionTranscript(id, query, { matchMode: 'phrase' })).toEqual([]);
    expect(searchSessionTranscript(id, query, { beforeSeq: 1, matchMode: 'keyword' })).toEqual([]);
  });
  it('finds Han substrings in both candidate and text queries without wildcard expansion', () => {
    const id = seed('青禾选择 SQLite');
    const other = seed('其他项目使用 PostgreSQL');
    expect(listSessionMetadata({ search: '青禾' }).items.map(row => row.key)).toEqual([id]);
    expect(searchSessionTranscript(id, '青禾')).toHaveLength(1);
    expect(searchSessionTranscript(other, '青禾')).toEqual([]);
    expect(listSessionMetadata({ search: '不存在%_' }).total).toBe(0);
  });
});
