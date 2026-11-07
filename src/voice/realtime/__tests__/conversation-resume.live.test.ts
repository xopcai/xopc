import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../config/schema.js';
import { getModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { XopcCloudModelSource } from '../../../providers/xopc-cloud-model-source.js';
import { transcriptRowsToClientHistory } from '../../../session/client-history.js';
import { SessionStore } from '../../../session/store.js';
import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { buildVoiceResumeHistory, voiceConversationInstructions } from '../conversation-context.js';
import { createOmniVoiceEngine } from '../omniEngine.js';
import { resolveOmniRoute } from '../omniRoute.js';

const firstFixture = process.env.XOPC_VOICE_RESUME_FIRST_PCM;
const secondFixture = process.env.XOPC_VOICE_RESUME_SECOND_PCM;
const enabled = process.env.XOPC_LIVE_VOICE_RESUME === '1' && Boolean(firstFixture && secondFixture);
const models = (process.env.XOPC_VOICE_RESUME_MODELS ?? 'boson/higgs-realtime').split(',');

/** Opt-in paid test, using synthetic speech and a fresh database; no owner transcript is changed. */
it.skipIf(!enabled).each(models)('remembers private voice discussion after hanging up and opening a fresh %s connection', async model => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog();
  const config = ConfigSchema.parse({ voice: { realtime: { enabled: true } } });
  if (model.startsWith('xopc-cloud/')) {
    const catalog = await new XopcCloudModelSource().fetch();
    if (catalog.status !== 'fetched') throw new Error('Cloud credentials are required for the opt-in live test');
    getModelCatalogStore().saveSource('xopc-cloud', { ...catalog.source, models: catalog.models });
  }
  const conversationId = crypto.randomUUID();
  const transcriptId = ensureSessionRecord(conversationId, '/tmp', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' }).transcriptId!;
  async function call(fixture: string, callId: string) {
    const store = new SessionStore({ config });
    const history = await store.loadMessages(conversationId);
    const route = await resolveOmniRoute(config, model);
    route.tools = false;
    route.instructions = voiceConversationInstructions(route.instructions, { identity: 'You are Ada.', history: [] });
    let done = false;
    let failure: string | undefined;
    const answers: string[] = [];
    const bytes = new Map<string, number>();
    const engine = createOmniVoiceEngine({ callId, route, restoreHistory: () => buildVoiceResumeHistory(history),
      silenceDurationMs: 300, bargeIn: true,
      send(type, payload) {
        if (type === 'session.error' && 'message' in payload) failure = String(payload.message);
        if (type === 'response.done') done = true;
      },
      sendAudio(id, audio) {
        const count = (bytes.get(id) ?? 0) + audio.length;
        bytes.set(id, count); engine.acknowledge(id, count / 48);
      },
      async record(entry) {
        await store.appendTranscriptCustomMessageEntry(conversationId, { expectedTranscriptId: transcriptId,
          customType: 'voice_omni_transcript', display: false, content: entry.text, details: { ...entry, callId } });
        if (entry.role === 'assistant') answers.push(entry.text);
      },
      async onClose() { done = true; },
    });
    try {
      await engine.start();
      expect(bytes.size).toBe(0);
      const audio = readFileSync(fixture);
      const started = performance.now();
      for (let offset = 0; !done && !failure && performance.now() - started < 35_000; offset += 640) {
        engine.appendAudio(offset < audio.length ? audio.subarray(offset, offset + 640) : Buffer.alloc(640));
        await delay(Math.max(0, started + (offset + 640) / 32 - performance.now()));
      }
      expect(failure).toBeUndefined();
      expect(done).toBe(true);
      expect([...bytes.values()].reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    } finally { await engine.close(); }
    return answers.join('\n');
  }
  try {
    await call(firstFixture!, 'first-call');
    const answer = await call(secondFixture!, 'redial');
    expect(answer).toContain('杭州');
    expect(answer).toMatch(/三千|3000|3,000/u);
    const store = new SessionStore({ config });
    expect(transcriptRowsToClientHistory(await store.loadTranscriptRows(conversationId))).toEqual([]);
  } finally { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); }
}, 90_000);
