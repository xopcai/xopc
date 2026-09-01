import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
const gatewayState = vi.hoisted(() => ({
  baseUrl: 'https://gw.example.com',
  lanUrl: 'http://192.168.1.10:18790' as string | null,
  token: 'tok',
  activeGatewayId: 'profile-1' as string | null,
}));

vi.mock('../../../storage/mmkv', () => ({
  KEYS: { routeWinnerPrefix: 'gateway.routeWinner:' },
  storage: {
    getString: (k: string) => memory.get(k),
    set: (k: string, v: string | number | boolean) => {
      memory.set(k, String(v));
    },
    delete: (k: string) => {
      memory.delete(k);
    },
  },
}));

vi.mock('../../../api/connection-strategy', () => ({
  raceGatewayRoutes: vi.fn(),
}));

vi.mock('../network-info', () => ({
  getNetworkSnapshot: vi.fn(() => ({ key: 'wifi:abc', kind: 'wifi', online: true })),
  isLikelyLanReachable: vi.fn(() => true),
}));

vi.mock('../../../stores/gateway-store', () => {
  return {
    useGatewayStore: { getState: () => gatewayState },
  };
});

import { raceGatewayRoutes } from '../../../api/connection-strategy';
import {
  acceptVerifiedGatewayRoute,
  __resetProbeCoordinatorForTests,
  getLastProbeTask,
  runProbeRound,
  subscribeProbeTask,
} from '../probe-coordinator';

const mockedRace = vi.mocked(raceGatewayRoutes);

beforeEach(() => {
  __resetProbeCoordinatorForTests();
  memory.clear();
  mockedRace.mockReset();
  Object.assign(gatewayState, {
    baseUrl: 'https://gw.example.com',
    lanUrl: 'http://192.168.1.10:18790',
    token: 'tok',
    activeGatewayId: 'profile-1',
  });
});

afterEach(() => {
  __resetProbeCoordinatorForTests();
});

describe('runProbeRound', () => {
  it('publishes a pre-verified route for the active profile without another race', () => {
    const listener = vi.fn();
    subscribeProbeTask(listener);

    acceptVerifiedGatewayRoute({
      profileId: 'profile-1',
      baseUrl: 'https://gw.example.com',
      lanUrl: 'http://192.168.1.10:18790',
      token: 'tok',
      winner: 'lan',
      url: 'http://192.168.1.10:18790',
      latencyMs: 31,
    });

    expect(getLastProbeTask()).toMatchObject({ online: true, result: { winner: 'lan' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mockedRace).not.toHaveBeenCalled();
  });

  it('runs the race once and broadcasts the task', async () => {
    mockedRace.mockResolvedValue({
      winner: 'lan',
      url: 'http://192.168.1.10:18790',
      latencyMs: 87,
      lan: { reachable: true, latencyMs: 87 },
      tunnel: { reachable: true, latencyMs: 412 },
    });

    const listener = vi.fn();
    const unsub = subscribeProbeTask(listener);

    const task = await runProbeRound('initial');
    expect(task.online).toBe(true);
    expect(task.result.winner).toBe('lan');
    expect(mockedRace).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it('returns the cached task within the freshness window', async () => {
    mockedRace.mockResolvedValue({
      winner: 'tunnel',
      url: 'https://gw.example.com',
      latencyMs: 220,
      lan: null,
      tunnel: { reachable: true, latencyMs: 220 },
    });

    const a = await runProbeRound('initial');
    const b = await runProbeRound('foreground');
    expect(a).toBe(b);
    expect(mockedRace).toHaveBeenCalledTimes(1);
  });

  it('forces a fresh probe past the freshness window when force=true', async () => {
    mockedRace.mockResolvedValue({
      winner: 'lan',
      url: 'http://192.168.1.10:18790',
      latencyMs: 50,
      lan: { reachable: true, latencyMs: 50 },
      tunnel: null,
    });

    await runProbeRound('initial');
    await runProbeRound('manual', { force: true });
    expect(mockedRace).toHaveBeenCalledTimes(2);
  });

  it('records online=false when the race fails on both routes', async () => {
    mockedRace.mockResolvedValue({
      winner: 'none',
      url: '',
      lan: { reachable: false, reason: 'timeout' },
      tunnel: { reachable: false, reason: 'timeout' },
    });

    const task = await runProbeRound('initial');
    expect(task.online).toBe(false);
    expect(getLastProbeTask()?.online).toBe(false);
  });

  it('does not reuse or publish an in-flight probe from the previous gateway', async () => {
    let resolveFirst!: (result: Awaited<ReturnType<typeof raceGatewayRoutes>>) => void;
    const first = new Promise<Awaited<ReturnType<typeof raceGatewayRoutes>>>((resolve) => {
      resolveFirst = resolve;
    });
    mockedRace
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        winner: 'tunnel',
        url: 'https://healthy.example.com',
        latencyMs: 40,
        lan: null,
        tunnel: { reachable: true, latencyMs: 40 },
      });

    const listener = vi.fn();
    subscribeProbeTask(listener);
    const staleProbe = runProbeRound('settings-saved', { force: true });

    Object.assign(gatewayState, {
      activeGatewayId: 'profile-2',
      baseUrl: 'https://healthy.example.com',
      lanUrl: null,
      token: 'healthy-token',
    });
    const healthyProbe = runProbeRound('settings-saved', { force: true });

    await expect(healthyProbe).resolves.toMatchObject({ online: true });
    expect(mockedRace).toHaveBeenCalledTimes(2);
    expect(getLastProbeTask()?.online).toBe(true);

    resolveFirst({
      winner: 'none',
      url: '',
      lan: { reachable: false, reason: 'timeout' },
      tunnel: { reachable: false, reason: 'timeout' },
    });
    await staleProbe;

    expect(getLastProbeTask()?.online).toBe(true);
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ online: false }));
  });
});
