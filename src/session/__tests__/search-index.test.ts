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

  it('indexes flat session json and finds keywords', async () => {
    root = join(tmpdir(), `xopc-sess-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, FILENAMES.SESSIONS_INDEX), JSON.stringify({ version: '1', lastUpdated: '', sessions: [] }));
    const stem = 'main_webchat_default_direct_testuser';
    writeFileSync(
      join(root, `${stem}.json`),
      JSON.stringify([
        { role: 'user', content: 'remember the alpha project deadline', timestamp: 1 },
        { role: 'assistant', content: 'Noted.', timestamp: 2 },
      ]),
    );

    const idx = new SessionSearchIndex();
    await idx.buildIndex(root);

    const hits = idx.search('alpha deadline', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].key).toContain('webchat');

    const msgs = idx.getSessionMessages(hits[0].key);
    expect(msgs.length).toBe(2);
  });
});
