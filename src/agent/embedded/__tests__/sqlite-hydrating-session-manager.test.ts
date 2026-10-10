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

const CONVERSATION_ID = "ebd6e242-f112-4ee7-885e-4874af77789e";
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
    const created = ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    appendTranscriptEntry(CONVERSATION_ID, { role: 'user', content: 'hello', timestamp: Date.now() });
    appendTranscriptEntry(CONVERSATION_ID, {
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
      conversationId: CONVERSATION_ID,
      transcriptId: created.transcriptId!,
      cwd: CWD,
    });

    expect(sm.getSessionId()).toBe(created.transcriptId);
    expect(sm.getSessionFile()).toBeUndefined();
    expect(sm.isPersisted()).toBe(false);

    const ctx = sm.buildSessionContext();
    expect(ctx.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(loadLlmMessagesForSession(CONVERSATION_ID)).toHaveLength(2);
  });
  it('restores voice speaker roles in the actual embedded Agent context', () => {
    const created = ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    for (const [role, content] of [['user', 'Remember my meeting'], ['assistant', 'We can prepare tomorrow']]) {
      appendTranscriptEntry(CONVERSATION_ID, { role: 'custom', customType: 'voice_omni_transcript', content, details: { role }, timestamp: 1 });
    }
    const sm = openSqliteHydratingSessionManager({ conversationId: CONVERSATION_ID, transcriptId: created.transcriptId!, cwd: CWD });
    expect(sm.buildSessionContext().messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(sm.buildSessionContext().messages).toEqual(loadLlmMessagesForSession(CONVERSATION_ID));
  });

  it('keeps Codemode state on the branch across a compaction boundary without adding it to LLM messages', () => {
    const created = ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: 'main' });
    appendTranscriptEntry(CONVERSATION_ID, { type: 'custom', customType: 'codemode-store', data: { set: { note: 'durable' }, delete: [] } });
    appendTranscriptEntry(CONVERSATION_ID, { type: 'custom', customType: 'xopc-tool-discovery', data: { loaded: [{ name: 'mcp__docs__search', contract: 'approved-current-contract' }] } });
    appendTranscriptEntry(CONVERSATION_ID, {
      type: 'compaction', at: new Date().toISOString(), baseSeq: 1, plannerVersion: 3,
      summaryModelRef: 'test/model', qualityAudit: 'disabled',
      handover: { version: 1, sourceThroughSeq: 1, items: [] },
      audit: { status: 'disabled', mode: 'structural', missingItemsFound: 0, repaired: false },
      summary: 'compacted context', messages: [{ role: 'user', content: 'kept request', timestamp: 1 }],
      firstKeptIndex: 0, tokensBefore: 100, tokensAfter: 10,
    });
    const sm = openSqliteHydratingSessionManager({ conversationId: CONVERSATION_ID, transcriptId: created.transcriptId!, cwd: CWD });
    expect(sm.getBranch()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'custom', customType: 'codemode-store', data: { set: { note: 'durable' }, delete: [] } }),
      expect.objectContaining({ type: 'custom', customType: 'xopc-tool-discovery', data: { loaded: [{ name: 'mcp__docs__search', contract: 'approved-current-contract' }] } }),
    ]));
    expect(JSON.stringify(sm.buildSessionContext().messages)).not.toContain('durable');
    expect(JSON.stringify(loadLlmMessagesForSession(CONVERSATION_ID))).not.toContain('codemode-store');
  });

});
