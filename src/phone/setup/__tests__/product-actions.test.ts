import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PhoneSetupView } from '@xopcai/gateway-contract';

vi.mock('../../../providers/index.js', async original => ({ ...await original<object>(), isProviderConfiguredSync: () => true }));
import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { AgentDefaultsSchema } from '../../../agent-config/schema.js';
import { ConfigSchema } from '../../../config/schema.js';
import { createPhoneSetupService } from '../../../gateway/hono/routes/phone-setup.js';
import type { GatewayService } from '../../../gateway/service.js';
import { getModelRegistry } from '../../../providers/model-registry.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { getPhoneRuntime } from '../../runtime.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'phone-setup-actions-'));
  vi.stubEnv('XOPC_STATE_DIR', root); vi.stubEnv('XOPC_WORKSPACE', root);
  openXopcDatabase({ path: join(root, 'test.db') });
  seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'test/chat' } } }), agents: [{ id: 'main', workspace: root }, { id: 'other', workspace: root }] });
});
afterEach(async () => { await getPhoneRuntime().shutdown(); vi.restoreAllMocks(); closeXopcDatabase(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it('sets only the current Agent Phone route while preserving inherited chat and other Agents', async () => {
  vi.spyOn(getModelRegistry(), 'resolve').mockReturnValue({ provider: 'test', id: 'phone', api: 'openai-completions', input: ['text', 'image'], phoneUse: { profile: 'autoglm-phone-v1' } } as any);
  const refreshAgentCatalog = vi.fn();
  const service = createPhoneSetupService({ currentConfig: ConfigSchema.parse({}), refreshAgentCatalog } as unknown as GatewayService);
  const context = { conversationId: 'test-conversation', agentId: 'main', canConfigure: true };
  const start = await service.command('start', {}, context) as PhoneSetupView;
  await service.command('set_model', { setupId: start.id, expectedRevision: start.revision, modelRef: 'test/phone' }, context);
  const repository = new AgentCatalogRepository();
  expect(repository.get('main')?.models).toEqual({ phoneUse: { primary: 'test/phone', fallbacks: [] } });
  expect(repository.getSettings().defaults.models.chat.primary).toBe('test/chat');
  expect(repository.get('other')?.models).toBeUndefined();
  expect(refreshAgentCatalog).toHaveBeenCalledOnce();
});
it('registers only discovered online local devices and does not widen an existing device policy', async () => {
  const runtime = getPhoneRuntime();
  vi.spyOn(runtime, 'discover').mockResolvedValue([{ serial: 'test-emulator', name: 'Emulator', state: 'device', emulator: true }]);
  const service = createPhoneSetupService({ currentConfig: ConfigSchema.parse({}) } as unknown as GatewayService);
  const context = { conversationId: 'local-conversation', agentId: 'main', canConfigure: true };
  let setup = await service.command('start', {}, context) as PhoneSetupView;
  setup = await service.command('source', { setupId: setup.id, expectedRevision: setup.revision, source: 'local' }, context) as PhoneSetupView;
  await expect(service.command('register_local', { setupId: setup.id, expectedRevision: setup.revision, serial: 'unseen-phone' }, context)).rejects.toThrow('DEVICE_OFFLINE');
  setup = await service.command('get', { setupId: setup.id }, context) as PhoneSetupView;
  setup = await service.command('register_local', { setupId: setup.id, expectedRevision: setup.revision, serial: 'test-emulator' }, context) as PhoneSetupView;
  const device = runtime.repository.list()[0];
  expect(device).toMatchObject({ serial: 'test-emulator', appAccess: 'selected', allowedApps: ['com.android.settings'] });
  runtime.repository.save({ ...device, enabled: false }, device.id);
  setup = await service.command('get', { setupId: setup.id }, context) as PhoneSetupView;
  setup = await service.command('register_local', { setupId: setup.id, expectedRevision: setup.revision, serial: 'test-emulator' }, context) as PhoneSetupView;
  expect(runtime.repository.get(device.id).enabled).toBe(false);
});

it('does not register a discovered phone after the original setup was cancelled', async () => {
  const runtime = getPhoneRuntime(); let entered!: () => void, resolve!: (devices: any[]) => void;
  const started = new Promise<void>(done => { entered = done; });
  const discovery = vi.spyOn(runtime, 'discover').mockResolvedValue([]);
  const service = createPhoneSetupService({ currentConfig: ConfigSchema.parse({}) } as unknown as GatewayService);
  const context = { conversationId: 'local-cancelled', agentId: 'main', canConfigure: true };
  let setup = await service.command('start', {}, context) as PhoneSetupView;
  // Selecting the source is a separate versioned product operation.
  setup = await service.command('source', { setupId: setup.id, source: 'local', expectedRevision: setup.revision }, context) as PhoneSetupView;
  discovery.mockImplementationOnce(async () => { entered(); return new Promise<any[]>(done => { resolve = done; }); });
  const pending = service.command('register_local', { setupId: setup.id, serial: 'late-phone', expectedRevision: setup.revision }, context);
  const rejected = expect(pending).rejects.toThrow(); await started;
  const cancelled = service.command('cancel', { setupId: setup.id }, context);
  resolve([{ serial: 'late-phone', name: 'Late phone', state: 'device', emulator: true }]);
  await rejected; await cancelled;
  expect(runtime.repository.list()).toHaveLength(0);
});
