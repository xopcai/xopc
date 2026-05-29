import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';

import { prepareSessionManagerForRun } from '../session-manager-init.js';
import { readTranscriptRowsFromFile } from '../../../session/parity/jsonl-transcript-io.js';
import { buildSessionContextForLlm } from '../../../session/session-context-for-llm.js';

describe('prepareSessionManagerForRun', () => {
  let dir: string;
  let sessionFile: string;
  const sessionId = 'aaa2f53e-7cc1-43bf-8581-84f4254cb335';

  beforeEach(async () => {
    dir = join(tmpdir(), `xopc-sm-init-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    sessionFile = join(dir, `${sessionId}.jsonl`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('allows pi SessionManager to create transcript on first assistant flush', async () => {
    const header = {
      type: 'session' as const,
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf-8');

    const sm = SessionManager.open(sessionFile, dir, process.cwd());
    await prepareSessionManagerForRun({
      sessionManager: sm,
      sessionFile,
      hadSessionFile: true,
      sessionId,
      cwd: process.cwd(),
    });

    expect(existsSync(sessionFile)).toBe(false);

    sm.appendMessage({
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    } as never);
    expect(existsSync(sessionFile)).toBe(false);

    sm.appendMessage({
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

    expect(existsSync(sessionFile)).toBe(true);
    const rows = await readTranscriptRowsFromFile(sessionFile);
    const llm = buildSessionContextForLlm(rows);
    expect(llm.some((m) => m.role === 'user')).toBe(true);
    expect(llm.some((m) => m.role === 'assistant')).toBe(true);
  });
});
