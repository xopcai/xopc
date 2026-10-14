import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { buildSystemPrompt } from '../../agent/prompt/system-prompt.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { appendTranscriptEntry, loadLlmMessagesForSession } from '../../storage/sqlite/transcript-repository.js';
import { createOrResumePersonalAgent } from '../service.js';

it('uses the renamed personal identity after an authenticated profile update while retaining old conversation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-personal-rename-'));
  vi.stubEnv('XOPC_STATE_DIR', dir);
  vi.stubEnv('XOPC_WORKSPACE', join(dir, 'workspace'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const token = 'personal-rename-test-token';
  const refreshAgentCatalog = vi.fn();
  const evictSessionAgent = vi.fn();
  const service = {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }),
    getAuthToken: () => token,
    isGatewayReady: () => true,
    getExtensionLoader: () => null,
    refreshAgentCatalog,
    agentService: { evictSessionAgent },
  } as unknown as GatewayService;
  const server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
  try {
    new AgentCatalogRepository().ensureInitialized();
    const record = await createOrResumePersonalAgent(service, 'local-owner', 'test/fast',
      async () => [{ id: 'test/fast', name: 'Fast' }]);
    appendTranscriptEntry(record.conversationId, { role: 'user', content: '你叫什么名字？' });
    appendTranscriptEntry(record.conversationId, { role: 'assistant', content: '我是 Ada。' });
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing Gateway address');
    refreshAgentCatalog.mockClear();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/personal-agent/profile`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ revision: record.revision, displayName: '阿沐', appearance: record.appearance,
        preferences: record.preferences }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ payload: { displayName: '阿沐', conversationId: record.conversationId } });
    expect(refreshAgentCatalog).toHaveBeenCalledOnce();
    expect(evictSessionAgent).toHaveBeenCalledWith(record.conversationId);
    const profile = resolveEffectiveAgentProfileForSession(record.conversationId);
    const prompt = buildSystemPrompt(dir, {
      agentProfile: profile.config.profile,
      customInstructions: profile.customInstructions,
      contextFiles: [{ path: 'profile/SOUL.md', content: 'Your name is Ada.' }],
    });
    expect(prompt).toContain('You are "阿沐".');
    expect(prompt).not.toContain('You are "Ada".');
    expect(prompt).toContain('It replaces conflicting Agent settings in earlier conversation, summaries, memory, and profile Markdown');
    expect(loadLlmMessagesForSession(record.conversationId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: '我是 Ada。' }),
    ]));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
