import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getSessionsJsonWriteStats,
  resetSessionsJsonCacheForTest,
} from '../parity/sessions-json-cache.js';
import { withSessionsJsonLock } from '../parity/sessions-json-file.js';
import {
  countTranscriptMessageRows,
  readTranscriptRowsPageFromFile,
} from '../parity/transcript-pagination.js';

describe('sessions.json patch writer cache', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    resetSessionsJsonCacheForTest();
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-sessions-json-'));
    storePath = join(tempDir, 'sessions.json');
  });

  afterEach(async () => {
    resetSessionsJsonCacheForTest();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('skips disk write when serialized payload is unchanged', async () => {
    await withSessionsJsonLock(storePath, async (map) => {
      map['agent:main:webchat:1'] = { sessionId: 's1', updatedAt: Date.now() };
    });
    expect(getSessionsJsonWriteStats().performed).toBe(1);

    await withSessionsJsonLock(storePath, async () => undefined);
    expect(getSessionsJsonWriteStats().skippedUnchanged).toBe(1);
    expect(getSessionsJsonWriteStats().performed).toBe(1);
  });
});

describe('transcript pagination', () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-transcript-page-'));
    transcriptPath = join(tempDir, 'session.jsonl');
    await writeFile(
      transcriptPath,
      [
        '{"type":"session","id":"s1","cwd":"/tmp"}',
        '{"type":"message","message":{"role":"user","content":"one"}}',
        '{"type":"message","message":{"role":"assistant","content":"two"}}',
        '{"type":"message","message":{"role":"user","content":"three"}}',
      ].join('\n') + '\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads tail page without parsing entire transcript into LLM context first', async () => {
    expect(await countTranscriptMessageRows(transcriptPath)).toBe(3);
    const page = await readTranscriptRowsPageFromFile(transcriptPath, { limit: 2 });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(2);
    expect((page.rows[0] as { content?: string }).content).toBe('two');
    expect((page.rows[1] as { content?: string }).content).toBe('three');
    expect(page.startIndex).toBe(1);
  });

  it('supports before cursor for older pages', async () => {
    const page = await readTranscriptRowsPageFromFile(transcriptPath, { limit: 2, beforeIndex: 1 });
    expect(page.rows).toHaveLength(1);
    expect((page.rows[0] as { content?: string }).content).toBe('one');
    expect(page.startIndex).toBe(0);
  });
});
