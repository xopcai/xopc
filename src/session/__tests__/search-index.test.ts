import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { SessionStore } from '../store.js';
import { SessionSearchIndex } from '../search-index.js';

const testConfig = ConfigSchema.parse({});

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

  it('indexes sessions.json + JSONL and finds keywords', async () => {
    root = join(tmpdir(), `xopc-sess-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const store = new SessionStore({ config: testConfig, sessionsDir: root });
    await store.initialize();
    const sessionKey = 'agent:main:webchat:default:direct:testuser';
    await store.saveMessages(sessionKey, [
      { role: 'user', content: 'remember the alpha project deadline' } as any,
      { role: 'assistant', content: 'Noted.' } as any,
    ]);

    const idx = new SessionSearchIndex();
    await idx.buildIndex(root);

    const hits = idx.search('alpha deadline', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].key).toBe(sessionKey);

    const msgs = idx.getSessionMessages(sessionKey);
    expect(msgs.length).toBe(2);
  });

  it('indexes kind:context text for session search', async () => {
    root = join(tmpdir(), `xopc-sess-ctx-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const store = new SessionStore({ config: testConfig, sessionsDir: root });
    await store.initialize();
    const sessionKey = 'agent:main:webchat:default:direct:ctxfind';
    await store.saveMessages(sessionKey, [{ role: 'user', content: 'hello' } as any]);
    await store.appendTranscriptContextEntry(sessionKey, { text: 'zephyr_audit_marker_xyz', id: 'evt-1' });

    const idx = new SessionSearchIndex();
    await idx.buildIndex(root);

    const hits = idx.search('zephyr_audit_marker', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].key).toBe(sessionKey);
  });
});
