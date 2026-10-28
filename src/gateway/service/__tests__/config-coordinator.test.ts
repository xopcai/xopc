import { beforeEach, expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import { GatewayConfigCoordinator, type GatewayConfigCoordinatorOptions } from '../config-coordinator.js';

const io = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock('../../../config/index.js', async original => ({ ...await original<typeof import('../../../config/index.js')>(), saveConfig: io.save, loadConfig: io.load }));
vi.mock('../../../observability/runtime.js', () => ({ configureTracing: async () => {} }));
let current: Config, disk: Config, coordinator: GatewayConfigCoordinator;
beforeEach(() => {
  current = ConfigSchema.parse({ mcp: { servers: { docs: { command: 'node' } } } }); disk = structuredClone(current);
  io.save.mockReset().mockImplementation(async (next: Config) => { disk = structuredClone(next); });
  io.load.mockReset().mockImplementation(() => structuredClone(disk));
  const options = { configPath: '/fixture/config.json', enableHotReload: false, getConfig: () => current,
    setConfig: (next: Config) => { current = next; },
    getAgentService: () => ({ applyRuntimeConfiguration: () => {} }), getChannelManager: () => ({ updateConfig: async () => {} }),
    reconcileMemoryMaintenanceAutomations: async () => {}, emit: () => {}, getChannelsStatus: () => [],
  } as unknown as GatewayConfigCoordinatorOptions;
  coordinator = new GatewayConfigCoordinator(options);
});

it('serializes persistence from service callers and rejects a stale write queued behind another save', async () => {
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>(done => { entered = done; });
  const gate = new Promise<void>(done => { release = done; });
  io.save.mockImplementationOnce(async (next: Config) => { entered(); await gate; disk = structuredClone(next); });
  const first = structuredClone(current), second = structuredClone(current);
  first.mcp!.servers!.first = { command: 'first' }; second.mcp!.servers!.second = { command: 'second' };
  const savingFirst = coordinator.saveConfig(first); await started;
  const savingSecond = coordinator.saveConfig(second);
  expect(io.save).toHaveBeenCalledTimes(1);
  release(); expect(await savingFirst).toMatchObject({ saved: true });
  expect(await savingSecond).toMatchObject({ saved: false, conflict: true });
  expect(disk.mcp!.servers!.first).toBeTruthy(); expect(disk.mcp!.servers!.second).toBeUndefined();
});

it('rejects a draft merge when another service operation changed its expected snapshot before the write', async () => {
  const base = structuredClone(current), draft = structuredClone(current);
  draft.mcp!.servers!.docs = { command: 'tested' };
  await coordinator.updateConfig({ gateway: { ...current.gateway, port: 19999 } });
  expect(await coordinator.saveConfig(draft, base)).toMatchObject({ saved: false, conflict: true });
  expect(current.gateway.port).toBe(19999); expect(current.mcp!.servers!.docs.command).toBe('node');
});

it('merges queued partial updates into the latest configuration and does not publish failed updates', async () => {
  await Promise.all([coordinator.updateConfig({ mcp: { servers: { added: { command: 'added' } } } }),
    coordinator.updateConfig({ gateway: { ...current.gateway, port: 19999 } })]);
  expect(current.mcp!.servers!.added).toBeTruthy(); expect(current.gateway.port).toBe(19999);
  const before = structuredClone(current); io.save.mockRejectedValueOnce(new Error('disk full'));
  expect(await coordinator.updateConfig({ mcp: { servers: {} } })).toMatchObject({ updated: false });
  expect(current).toEqual(before);
});

it('retains the committed snapshot on reload errors so a later save cannot restore stale disk contents', async () => {
  const next = structuredClone(current); next.mcp!.servers!.docs = { command: 'committed' };
  io.load.mockImplementationOnce(() => { throw new Error('reload failed'); });
  expect(await coordinator.saveConfig(next)).toMatchObject({ saved: false, persisted: true });
  expect(current.mcp!.servers!.docs.command).toBe('committed');
  expect(disk.mcp!.servers!.docs.command).toBe('committed');
  await coordinator.updateConfig({ gateway: { ...current.gateway, port: 19999 } });
  expect(disk.mcp!.servers!.docs.command).toBe('committed');
});

it('rechecks a pending configuration grant at the serialized commit boundary', async () => {
  const next = structuredClone(current); next.phone.enabled = true;
  const beforeCommit = vi.fn(() => { throw new Error('setup cancelled'); });
  await expect(coordinator.saveConfig(next, current, beforeCommit)).rejects.toThrow('cancelled');
  expect(io.save).not.toHaveBeenCalled(); expect(current.phone.enabled).toBe(false);
});
