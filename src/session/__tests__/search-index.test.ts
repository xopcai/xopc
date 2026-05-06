import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { FILENAMES } from '../../config/paths.js';
import { SessionSearchIndex } from '../search-index.js';

describe('SessionSearchIndex', () => {
  let root: string;

  afterEach(() => {
    if (root) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('indexes wrapped session transcript and finds keywords', async () => {
    root = join(tmpdir(), `xopc-sess-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, FILENAMES.SESSIONS_INDEX), JSON.stringify({ version: '1', lastUpdated: '', sessions: [] }));
    const stem = 'main_webchat_default_direct_testuser';
    writeFileSync(
      join(root, `${stem}.json`),
      JSON.stringify({
        type: 'xopc_session_transcript',
        version: 1,
        id: '00000000-0000-4000-8000-000000000001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        messages: [
          { role: 'user', content: 'remember the alpha project deadline', timestamp: 1 },
          { role: 'assistant', content: 'Noted.', timestamp: 2 },
        ],
      }),
    );

    const idx = new SessionSearchIndex();
    await idx.buildIndex(root);

    const hits = idx.search('alpha deadline', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].key).toContain('webchat');

    const msgs = idx.getSessionMessages(hits[0].key);
    expect(msgs.length).toBe(2);
  });

  it('indexes wrapped xopc_session_transcript json', async () => {
    root = join(tmpdir(), `xopc-sess-wrap-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, FILENAMES.SESSIONS_INDEX), JSON.stringify({ version: '1', lastUpdated: '', sessions: [] }));
    const stem = 'main_webchat_default_direct_wrapuser';
    writeFileSync(
      join(root, `${stem}.json`),
      JSON.stringify({
        type: 'xopc_session_transcript',
        version: 1,
        id: '00000000-0000-4000-8000-000000000099',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        messages: [
          { role: 'user', content: 'wrapsession omega keyword', timestamp: 1 },
          { role: 'assistant', content: 'ok', timestamp: 2 },
        ],
      }),
    );

    const idx = new SessionSearchIndex();
    await idx.buildIndex(root);

    const hits = idx.search('omega keyword', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(idx.getSessionMessages(hits[0].key)).toHaveLength(2);
  });

  it('indexes kind:context text for session search', async () => {
    root = join(tmpdir(), `xopc-sess-ctx-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, FILENAMES.SESSIONS_INDEX), JSON.stringify({ version: '1', lastUpdated: '', sessions: [] }));
    const stem = 'main_webchat_default_direct_ctxfind';
    writeFileSync(
      join(root, `${stem}.json`),
      JSON.stringify({
        type: 'xopc_session_transcript',
        version: 1,
        id: '00000000-0000-4000-8000-0000000000aa',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        messages: [
          { role: 'user', content: 'hello', timestamp: 1 },
          { kind: 'context', text: 'zephyr_audit_marker_xyz', id: 'evt-1', createdAt: '2026-01-02T00:00:01.000Z' },
        ],
      }),
    );

    const idx = new SessionSearchIndex();
    await idx.buildIndex(root);

    const hits = idx.search('zephyr_audit_marker_xyz', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].key).toContain('ctxfind');
    expect(idx.getSessionMessages(hits[0].key)).toHaveLength(1);
  });
});
