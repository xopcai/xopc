import { isDeepStrictEqual } from 'node:util';

import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../../../config/schema.js';
import { registerConfigRoutes } from '../config.js';
import type { AuthenticatedRouteDeps } from '../deps.js';

const patch = vi.hoisted(() => ({ misc: vi.fn() }));
vi.mock('../config-patch/index.js', () => ({ applyChannelsPatch: () => {}, applyGatewayPatch: () => ({ ok: true }),
  applyMiscPatch: patch.misc, validateGatewayAfterPatch: () => ({ ok: true }) }));

it('retains the original expected snapshot across async patch preparation and reports concurrent service writes', async () => {
  const initial = ConfigSchema.parse({ mcp: { servers: { docs: { command: 'node' } } } });
  let current = structuredClone(initial);
  const save = vi.fn(async (next: Config, expected?: Config) => {
    if (!isDeepStrictEqual(current, expected)) return { saved: false, conflict: true, error: 'Concurrent update' };
    current = next; return { saved: true };
  });
  patch.misc.mockImplementationOnce(async (candidate: Config) => {
    candidate.mcp!.servers!.docs = { command: 'edited' };
    await Promise.resolve();
    current = structuredClone(current);
    current.mcp!.servers!.other = { command: 'created concurrently' };
    return { ok: true };
  });
  const app = new Hono();
  registerConfigRoutes(app, { service: { get currentConfig() { return current; }, saveConfig: save },
    strictRateLimitMiddleware: async (_context, next) => next(),
  } as unknown as AuthenticatedRouteDeps);
  const response = await app.request('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(409);
  expect(save).toHaveBeenCalledWith(expect.anything(), initial);
  expect(current.mcp!.servers!.docs.command).toBe('node');
  expect(current.mcp!.servers!.other.command).toBe('created concurrently');
});

it('rejects stale voice settings inside the write lock before any mutation', async () => {
  const { voiceSettingsRevisions } = await import('../../lib/voice-settings-revisions.js');
  const initial = ConfigSchema.parse({ messages: { tts: { provider: 'openai', providers: { openai: { model: 'tts-1' } } } } });
  const revision = voiceSettingsRevisions(initial).speech;
  const current = structuredClone(initial);
  current.messages.tts.provider = 'xopc-cloud';
  const save = vi.fn(); patch.misc.mockClear();
  const app = new Hono();
  registerConfigRoutes(app, { service: { currentConfig: current, saveConfig: save }, strictRateLimitMiddleware: async (_context, next) => next() } as unknown as AuthenticatedRouteDeps);
  const response = await app.request('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVoiceRevision: { capability: 'speech', revision }, tts: initial.messages.tts }) });
  expect(response.status).toBe(409);
  expect(save).not.toHaveBeenCalled(); expect(patch.misc).not.toHaveBeenCalled();
  expect(current.messages.tts.provider).toBe('xopc-cloud');
});

it('rejects malformed voice revision guards', async () => {
  const save = vi.fn(); const app = new Hono();
  registerConfigRoutes(app, { service: { currentConfig: ConfigSchema.parse({}), saveConfig: save }, strictRateLimitMiddleware: async (_context, next) => next() } as unknown as AuthenticatedRouteDeps);
  const response = await app.request('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVoiceRevision: { capability: 'speech', revision: 'bad' } }) });
  expect(response.status).toBe(400); expect(save).not.toHaveBeenCalled();
});

it('isolates each voice capability version from unrelated settings', async () => {
  const { voiceSettingsRevisions } = await import('../../lib/voice-settings-revisions.js');
  const initial = ConfigSchema.parse({ messages: { tts: { trigger: 'off' } } }); const before = voiceSettingsRevisions(initial);
  initial.messages.tts.trigger = 'always';
  const after = voiceSettingsRevisions(initial);
  expect(after.speech).not.toBe(before.speech);
  expect(after.transcription).toBe(before.transcription); expect(after.conversation).toBe(before.conversation);
});

it('versions text processing with recognition without invalidating speech or conversation settings', async () => {
  const { voiceSettingsRevisions } = await import('../../lib/voice-settings-revisions.js');
  const config = ConfigSchema.parse({ voice: { input: { refinement: { mode: 'off' } } } });
  const before = voiceSettingsRevisions(config);
  config.voice!.input.refinement.mode = 'punctuation';
  const after = voiceSettingsRevisions(config);
  expect(after.transcription).not.toBe(before.transcription);
  expect(after.speech).toBe(before.speech);
  expect(after.conversation).toBe(before.conversation);
});
