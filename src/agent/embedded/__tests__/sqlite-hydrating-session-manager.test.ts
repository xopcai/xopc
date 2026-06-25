import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendTranscriptEntry,
  closeXopcDatabase,
  ensureSessionRecord,
  loadLlmMessagesForSession,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { openSqliteHydratingSessionManager } from '../sqlite-hydrating-session-manager.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:sqlite-sm';
const CWD = '/tmp/workspace';

describe('openSqliteHydratingSessionManager', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-sqlite-sm-'));
    resetXopcDatabaseSingletonForTest();
    process.env.XOPC_STATE_DIR = stateDir;
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    delete process.env.XOPC_STATE_DIR;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('hydrates in-memory SessionManager from SQLite transcript rows', () => {
    const created = ensureSessionRecord(SESSION_KEY, CWD);
    appendTranscriptEntry(SESSION_KEY, { role: 'user', content: 'hello', timestamp: Date.now() });
    appendTranscriptEntry(SESSION_KEY, {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
      timestamp: Date.now(),
      provider: 'openai',
      model: 'gpt-4',
      stopReason: 'stop',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    } as never);

    const sm = openSqliteHydratingSessionManager({
      sessionKey: SESSION_KEY,
      sessionId: created.sessionId!,
      cwd: CWD,
    });

    expect(sm.getSessionId()).toBe(created.sessionId);
    expect(sm.getSessionFile()).toBeUndefined();
    expect(sm.isPersisted()).toBe(false);

    const ctx = sm.buildSessionContext();
    expect(ctx.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(loadLlmMessagesForSession(SESSION_KEY)).toHaveLength(2);
  });
});
