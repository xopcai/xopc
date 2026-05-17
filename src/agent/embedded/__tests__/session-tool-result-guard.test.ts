import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';

import { guardSessionManager } from '../session-tool-result-guard-wrapper.js';
import { repairAssistantUsageInSessionManager } from '../session-manager-init.js';
import { readTranscriptRowsFromFile } from '../../../session/parity/jsonl-transcript-io.js';
import { appendPiTranscriptContextEntry } from '../../../session/parity/jsonl-transcript-io.js';
import { buildSessionContextForLlm } from '../../../session/session-context-for-llm.js';

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

  it('appendMessage persists assistant text to JSONL', async () => {
    const sm = guardSessionManager(SessionManager.open(sessionFile, dir, process.cwd()), {
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

    expect(existsSync(sessionFile)).toBe(true);
    const rows = await readTranscriptRowsFromFile(sessionFile);
    const llm = buildSessionContextForLlm(rows);
    expect(llm.some((m) => m.role === 'user')).toBe(true);
    expect(llm.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('repairAssistantUsageInSessionManager fills missing usage on assistant rows', () => {
    const sm = SessionManager.open(sessionFile, dir, process.cwd());
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

  it('appendPiTranscriptContextEntry excludes context from LLM projection', async () => {
    await appendPiTranscriptContextEntry({
      absPath: sessionFile,
      cwd: process.cwd(),
      entry: { kind: 'context', text: 'audit line', createdAt: new Date().toISOString() },
      sessionKey: 'agent:main:test',
    });
    const rows = await readTranscriptRowsFromFile(sessionFile);
    const llm = buildSessionContextForLlm(rows);
    expect(llm).toHaveLength(0);
    expect(rows.some((r) => typeof r === 'object' && r !== null && 'kind' in r && (r as { kind: string }).kind === 'context')).toBe(
      true,
    );
  });
});
