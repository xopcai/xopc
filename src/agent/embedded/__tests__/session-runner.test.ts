import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeContext } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireEmbeddedSessionRunner,
  buildEmbeddedRunnerFingerprint,
  drainEmbeddedSessionRunnerShutdowns,
  evictEmbeddedSessionRunner,
  getEmbeddedSessionRunnerStats,
  isEmbeddedSessionRunnerEnabled,
  resetEmbeddedSessionRunnerForTest,
} from '../session-runner.js';
import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { PROMPT_CACHE_BOUNDARY } from '../../prompt/cache-boundary.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/connection.js';

describe('EmbeddedSessionRunner fingerprint', () => {
  afterEach(() => {
    resetEmbeddedSessionRunnerForTest();
    delete process.env.XOPC_SESSION_RUNNER;
    delete process.env.XOPC_SESSION_RUNNER_TTL_MS;
  });

  it('changes when model, tools, system prompt, or provider credential changes', () => {
    const base = {
      transcriptId: 'aaa2f53e-7cc1-43bf-8581-84f4254cb335',
      workspaceDir: '/tmp/ws',
      modelRef: 'openai/gpt-4o',
      toolNames: ['read', 'write'],
      toolContracts: ['read-v1', 'write-v1'],
      systemPrompt: 'You are helpful.',
      thinkingLevel: 'medium',
      credentialRevision: 'current-credential',
    };

    const a = buildEmbeddedRunnerFingerprint(base);
    const b = buildEmbeddedRunnerFingerprint({ ...base, modelRef: 'anthropic/claude-sonnet' });
    const c = buildEmbeddedRunnerFingerprint({ ...base, toolNames: ['read'] });
    const d = buildEmbeddedRunnerFingerprint({ ...base, systemPrompt: 'Different prompt.' });
    const e = buildEmbeddedRunnerFingerprint({ ...base, credentialRevision: 'new-credential' });

    expect(b).not.toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
    expect(e).not.toBe(a);
    expect(buildEmbeddedRunnerFingerprint({ ...base, toolContracts: ['read-v2', 'write-v1'] })).not.toBe(a);
    const mcp = { servers: [], errors: [], credentialAliases: { docs: 'first' } };
    expect(buildEmbeddedRunnerFingerprint({ ...base, mcp: { ...mcp, automationSourceRunId: 'first-run' } }))
      .not.toBe(buildEmbeddedRunnerFingerprint({ ...base, mcp: { ...mcp, automationSourceRunId: 'next-run' } }));
    expect(buildEmbeddedRunnerFingerprint({ ...base, mcp })).not.toBe(buildEmbeddedRunnerFingerprint({ ...base, mcp: { ...mcp, credentialAliases: { docs: 'second' } } }));
    const codemode = { enabled: true, timeoutMs: 60_000, maxConcurrentCalls: 4, maxCalls: 32, maxOutputTokens: 4000 };
    const enabled = buildEmbeddedRunnerFingerprint({ ...base, codemode });
    expect(enabled).not.toBe(a);
    expect(buildEmbeddedRunnerFingerprint({ ...base, codemode: { ...codemode, enabled: false } })).not.toBe(enabled);
    expect(buildEmbeddedRunnerFingerprint({ ...base, codemode: { ...codemode, maxCalls: 2 } })).not.toBe(enabled);
    const executionToolPolicy = { surface: 'personal_main' as const, nativeMcp: false,
      externalMaterialization: false, discovery: false, codemode: false, revision: 'v1' };
    const restricted = buildEmbeddedRunnerFingerprint({ ...base, executionToolPolicy });
    expect(restricted).not.toBe(a);
    expect(buildEmbeddedRunnerFingerprint({ ...base, executionToolPolicy: { ...executionToolPolicy, revision: 'v2' } })).not.toBe(restricted);
  });

  it('is stable for identical inputs regardless of tool order', () => {
    const inputA = {
      transcriptId: 'aaa2f53e-7cc1-43bf-8581-84f4254cb335',
      workspaceDir: '/tmp/ws',
      modelRef: 'openai/gpt-4o',
      toolNames: ['b', 'a'],
      toolContracts: ['b-v1', 'a-v1'],
      systemPrompt: 'Prompt',
      thinkingLevel: 'low',
      credentialRevision: 'current-credential',
    };
    const inputB = { ...inputA, toolNames: ['a', 'b'], toolContracts: ['a-v1', 'b-v1'] };
    expect(buildEmbeddedRunnerFingerprint(inputA)).toBe(buildEmbeddedRunnerFingerprint(inputB));
  });

  it('respects XOPC_SESSION_RUNNER disable flag', () => {
    expect(isEmbeddedSessionRunnerEnabled()).toBe(true);
    process.env.XOPC_SESSION_RUNNER = '0';
    expect(isEmbeddedSessionRunnerEnabled()).toBe(false);
  });

  it('does not bump eviction stats for missing pooled entries', () => {
    resetEmbeddedSessionRunnerForTest();
    const before = getEmbeddedSessionRunnerStats().evictions;
    evictEmbeddedSessionRunner('missing-session');
    expect(getEmbeddedSessionRunnerStats().evictions).toBe(before);
    expect(getEmbeddedSessionRunnerStats().pooled).toBe(0);
  });

  it('sends one stable cache identity and applies the latest policy on runner reuse', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'xopc-runner-cache-'));
    vi.stubEnv('XOPC_STATE_DIR', cwd);
    const transcriptRuntime = new InMemoryTranscriptRuntime({ runtimeId: 'cache-runner', cwd });
    const model = getModel('openai', 'gpt-6.2-sol');
    const params = { runtimeId: transcriptRuntime.runtimeId, transcriptId: transcriptRuntime.transcriptId,
      workspaceDir: cwd, model, modelRef: 'openai/gpt-6.2-sol', systemPrompt: 'stable', tools: [],
      thinkingLevel: 'off' as const, transcriptRuntime };
    const payloads: Array<Record<string, unknown>> = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      const event = { type: 'response.completed', response: { id: 'fixture', status: 'completed', output: [],
        usage: { input_tokens: 20, output_tokens: 0, total_tokens: 20 } } };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    };
    try {
      openXopcDatabase({ path: join(cwd, 'xopc.db') });
      seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: cwd }] });
      for (const [index, mode] of ['auto', 'auto', 'off'].entries()) {
        const runner = await acquireEmbeddedSessionRunner({ ...params,
          promptCachePolicy: { mode: mode === 'off' ? 'off' : 'auto', lifetime: 'short' } });
        try {
          expect(runner.reused).toBe(index > 0);
          const context = normalizeContext({
            systemPrompt: `stable${PROMPT_CACHE_BOUNDARY}dynamic ${index}`,
            messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
          });
          const stream = await runner.session.agent.streamFunction(model, context, { apiKey: 'sk-fixture', fetch, maxRetries: 0 });
          expect((await stream.result()).errorMessage).toBeUndefined();
        } finally {
          runner.release();
        }
      }
      expect(payloads[0]).toMatchObject({ instructions: 'dynamic 0', prompt_cache_key: expect.any(String) });
      expect(payloads[1]).toMatchObject({ instructions: 'dynamic 1', prompt_cache_key: payloads[0]!.prompt_cache_key });
      expect(payloads[0]!.input).toEqual(payloads[1]!.input);
      expect(payloads[2]).not.toHaveProperty('prompt_cache_key');
      expect(payloads[2]).toMatchObject({ prompt_cache_options: { mode: 'explicit' } });
    } finally {
      evictEmbeddedSessionRunner(transcriptRuntime.runtimeId);
      await drainEmbeddedSessionRunnerShutdowns();
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      vi.unstubAllEnvs();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
