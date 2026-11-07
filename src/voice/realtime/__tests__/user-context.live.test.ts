import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, it } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { ConfigSchema } from '../../../config/schema.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { applyUserProfilePatch } from '../../../user-model/profile.js';
import { voiceConversationInstructions } from '../conversation-context.js';
import { createOmniVoiceEngine } from '../omniEngine.js';
import { resolveHiggsRoute } from '../omniRoute.js';
import { buildVoiceUserContext } from '../user-context.js';

const fixture = process.env.XOPC_VOICE_IDENTITY_PCM;
const enabled = process.env.XOPC_LIVE_VOICE_IDENTITY === '1' && Boolean(fixture);

/** Opt-in paid test: synthetic identity and in-memory storage; never modifies the owner's profile. */
it.skipIf(!enabled).each(['saved', 'unknown', 'introduction', 'correction'])('grounds live Higgs identity without adopting assistant guesses (%s)', async scenario => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
  const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
  const agentId = personalAgentId('local-owner'); catalog.create({ id: agentId }, { ready: true });
  const conversationId = createConversation({ agentId, sourceChannel: 'webchat', customData: { personalAgent: true } }).key;
  if (scenario === 'saved' || scenario === 'correction') applyUserProfilePatch({ callName: '小林', role: '软件工程师' });
  const config = ConfigSchema.parse({ voice: { realtime: { enabled: true } } });
  const history: AgentMessage[] = [
      { role: 'user', content: '你认识我吗？', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: '你叫小周。' }], timestamp: 2 } as AgentMessage,
      { role: 'user', content: '你确定我叫小周？', timestamp: 3 },
      ...(scenario === 'introduction' ? [{ role: 'user' as const, content: '以后叫我小林，我是软件工程师。', timestamp: 4 }] : []),
      ...(scenario === 'correction' ? [{ role: 'user' as const, content: '现在改叫我小夏，不再叫小林。', timestamp: Date.now() + 1 }] : []),
    ];
  const user = buildVoiceUserContext({ getConfig: () => config, conversationId, history })!;
  const route = await resolveHiggsRoute(config);
  route.instructions = voiceConversationInstructions(route.instructions, { identity: 'You are Ada, the owner’s personal assistant.', user, history });
  let done = false;
  let failure: string | undefined;
  const answers: string[] = [];
  const bytes = new Map<string, number>();
  const engine = createOmniVoiceEngine({ callId: 'voice-identity-live-test', route, silenceDurationMs: 300, bargeIn: true,
    send(type, payload) {
      if (type === 'session.error' && 'message' in payload) failure = String(payload.message);
      if (type === 'response.done') done = true;
    },
    sendAudio(id, audio) { const count = (bytes.get(id) ?? 0) + audio.length; bytes.set(id, count); engine.acknowledge(id, count / 48); },
    async record(entry) { if (entry.role === 'assistant') answers.push(entry.text); },
    async onClose() { done = true; },
  });
  try {
    const audio = readFileSync(fixture!);
    await engine.start();
    const started = performance.now();
    for (let offset = 0; !done && !failure && performance.now() - started < 30_000; offset += 640) {
      engine.appendAudio(offset < audio.length ? audio.subarray(offset, offset + 640) : Buffer.alloc(640));
      await delay(Math.max(0, started + (offset + 640) / 32 - performance.now()));
    }
    expect(failure).toBeUndefined();
    expect(done).toBe(true);
    expect([...bytes.values()].reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    const answer = answers.join('\n');
    if (scenario === 'correction') expect(answer).toContain('小夏');
    else if (scenario !== 'unknown') expect(answer).toContain('小林');
    else expect(answer).toMatch(/没.*(?:告诉|确认|记录|提供)|不(?:确定|知道|清楚)|无法确认|需要.*确认/u);
    expect(answer).not.toMatch(/(?:你叫|你的名字是)小周/u);
  } finally { await engine.close(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); }
}, 45_000);
