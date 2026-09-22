import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { GatewaySceneHost } from '../../../gateway/scenes/host.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { createXopcUseTool } from '../xopc-use-tool.js';

let dir: string;
let host: GatewaySceneHost;
const principal = { ownerId: 'local-owner', workspaceId: 'test-workspace' };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xopc-scene-tool-'));
  resetXopcDatabaseSingletonForTest();
  const { db } = openXopcDatabase({ path: join(dir, 'xopc.db') });
  host = new GatewaySceneHost(db, { principal, config: () => ConfigSchema.parse({}), publish: () => {}, executor: {
    execute: async ({ evidence }) => ({ kind: 'artifact', summary: 'Leave Sunday free.', evidenceIds: evidence.map(item => item.id) }),
  } });
});
afterEach(async () => { await host.stop(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

it('uses the same activation and revision rules for Agent calls and the Gateway', async () => {
  const tool = createXopcUseTool({ getSceneAccess: () => ({ principal, services: host.http }) });
  let requestSequence = 0;
  const call = async (command: string, args: Record<string, unknown>, request = command === 'start' ? 'start' : `tool-call-${requestSequence++}`) => {
    const result = await tool.execute(request, { mode: 'scene', command, args });
    const text = (result.content[0] as { text: string }).text;
    return text.startsWith('Error:') ? { ok: false, error: text } : JSON.parse(text.split('\nOpen in xopc:')[0]);
  };
  const input = { templateKey: 'weekly-family-plan', templateVersion: '1.0.0', goal: 'Keep Sunday free', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } };
  const created = await call('start', input);
  const activation = created.activation;
  expect(activation).toBeDefined();
  expect((await call('start', input)).activation.id).toBe(activation.id);
  await call('notes', { id: activation.id, expectedRevision: 0, content: 'Sunday is free.' });
  await call('check', { id: activation.id }, 'check');
  await host.tick();
  expect(host.http.repository.listInbox(principal)).toHaveLength(1);
  expect((await call('results', { id: activation.id })).outcomes).toHaveLength(1);
  await call('transition', { id: activation.id, expectedRevision: activation.revision, status: 'paused' });
  expect(host.http.repository.getActivation(principal, activation.id).status).toBe('paused');
  expect((await call('transition', { id: activation.id, expectedRevision: activation.revision, status: 'active' })).ok).toBe(false);
});

it('returns a first-class scene delivery and exposes controls shared with the Web UI', async () => {
  const tool = createXopcUseTool({ getSceneAccess: () => ({ principal, services: host.http }) });
  const input = { templateKey: 'weekly-family-plan', templateVersion: '1.0.0', goal: 'Keep Sunday free', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } };
  const created = await tool.execute('create-scene', { mode: 'scene', command: 'start', args: input });
  const activation = (created.details.result as { activation: { id: string } }).activation;
  expect(created.details.delivery).toMatchObject({ operation: 'created', primary: { kind: 'scene', id: activation.id } });

  const preferences = await tool.execute('preferences', { mode: 'scene', command: 'set_preferences', args: { expectedRevision: 0, notificationsMuted: true } });
  expect(preferences.details.result).toMatchObject({ revision: 1, notificationsMuted: true });
  const diagnostics = await tool.execute('diagnostics', { mode: 'scene', command: 'diagnostics' });
  expect(diagnostics.details.result).toMatchObject({ checksPaused: false, pendingChecks: 0 });
  const invalidRead = await tool.execute('invalid-read', { mode: 'scene', command: 'mark_read', args: { presentationId: 'missing', read: 'yes' } });
  expect(invalidRead.content[0]).toMatchObject({ type: 'text', text: 'Error: read must be a boolean' });
});
