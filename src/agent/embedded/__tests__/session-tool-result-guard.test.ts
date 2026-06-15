import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';

import { guardSessionManager } from '../session-tool-result-guard.js';
import { repairAssistantUsageInSessionManager } from '../session-manager-init.js';
import { writeRuntimeTranscriptJsonl } from '../../../session/runtime-transcript.js';
import { buildSessionContextForLlm } from '../../../session/session-context-for-llm.js';
import { onSessionTranscriptUpdate } from '../../../session/transcript-events.js';

describe('session-tool-result-guard', () => {
  let dir: string;
  let sessionFile: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `xopc-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    sessionFile = join(dir, 'sess.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appendMessage emits transcript update for SQLite-backed session key', async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionTranscriptUpdate(listener);

    const sm = guardSessionManager(SessionManager.inMemory(process.cwd()), {
      sessionKey: 'agent:main:test',
    });
    sm.appendMessage({
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    } as never);
    sm.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
      timestamp: Date.now(),
    } as never);

    expect(listener).toHaveBeenCalled();
    const updates = listener.mock.calls.map(([update]) => update);
    expect(updates.some((update) => (update?.message as { role?: string })?.role === 'user')).toBe(true);
    expect(updates.some((update) => (update?.message as { role?: string })?.role === 'assistant')).toBe(true);
    unsubscribe();
  });

  it('repairAssistantUsageInSessionManager fills missing usage on assistant rows', () => {
    const sm = SessionManager.inMemory(process.cwd());
    sm.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'legacy' }],
      timestamp: Date.now(),
      stopReason: 'stop',
    } as never);
    repairAssistantUsageInSessionManager(sm);
    const ctx = sm.buildSessionContext();
    const assistant = ctx.messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect((assistant as { usage?: { totalTokens?: number } }).usage?.totalTokens).toBe(0);
  });

  it('runtime context rows exclude context from LLM projection', async () => {
    await writeRuntimeTranscriptJsonl({
      absPath: sessionFile,
      sessionId: 'ctx-test',
      cwd: process.cwd(),
      rows: [{ kind: 'context', text: 'audit line', id: 'e1', createdAt: new Date().toISOString() }],
    });
    expect(existsSync(sessionFile)).toBe(true);
    const sm = SessionManager.open(sessionFile, dir, process.cwd());
    const llm = buildSessionContextForLlm(sm.getEntries() as never);
    expect(llm).toHaveLength(0);
  });
});
