import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deletePersistedE2eeSession,
  loadAllPersistedE2eeSessions,
  loadPersistedE2eeSession,
} from '../session-persist.js';
import {
  consumeRequestSeq,
  createE2eeSession,
  ensureE2eeSessionsLoaded,
  resetE2eeSessionsForTests,
} from '../session-store.js';

describe('e2ee session persistence', () => {
  let stateDir = '';

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-e2ee-'));
    vi.stubEnv('XOPC_STATE_DIR', stateDir);
    resetE2eeSessionsForTests();
  });

  afterEach(() => {
    resetE2eeSessionsForTests();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists and reloads session seq counters across process restart simulation', async () => {
    const devicePub = new Uint8Array(32).fill(9);
    await createE2eeSession({ sessionId: 'persist-a', devicePublicKey: devicePub });
    expect(consumeRequestSeq('persist-a', 1)).not.toBeNull();
    expect(consumeRequestSeq('persist-a', 2)).not.toBeNull();

    resetE2eeSessionsForTests();
    await ensureE2eeSessionsLoaded();

    expect(consumeRequestSeq('persist-a', 2)).not.toBeNull();
    expect(consumeRequestSeq('persist-a', 3)).not.toBeNull();
    expect(consumeRequestSeq('persist-a', 1)).toBeNull();
  });

  it('round-trips session through disk record', async () => {
    const devicePub = new Uint8Array(32).fill(3);
    await createE2eeSession({ sessionId: 'disk-b', devicePublicKey: devicePub });
    expect(consumeRequestSeq('disk-b', 1)).not.toBeNull();

    resetE2eeSessionsForTests();
    const loaded = await loadPersistedE2eeSession('disk-b');
    expect(loaded?.reqSeq).toBe(1);

    deletePersistedE2eeSession('disk-b');
    expect(await loadPersistedE2eeSession('disk-b')).toBeNull();
  });

  it('loadAllPersistedE2eeSessions skips expired records', async () => {
    const devicePub = new Uint8Array(32).fill(1);
    await createE2eeSession({ sessionId: 'expired-c', devicePublicKey: devicePub });

    const filePath = join(stateDir, 'e2ee', 'sessions', 'expired-c.json');
    const record = JSON.parse(readFileSync(filePath, 'utf8')) as { expiresAt: number };
    record.expiresAt = Date.now() - 1_000;
    writeFileSync(filePath, JSON.stringify(record));

    resetE2eeSessionsForTests();
    const loaded = await loadAllPersistedE2eeSessions();
    expect(loaded).toHaveLength(0);
  });
});
