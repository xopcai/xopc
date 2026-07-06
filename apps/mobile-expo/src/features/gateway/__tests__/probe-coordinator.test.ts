import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

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
  const state = {
    baseUrl: 'https://gw.example.com',
    lanUrl: 'http://192.168.1.10:18790',
    token: 'tok',
    activeGatewayId: 'profile-1',
  };
  return {
    useGatewayStore: { getState: () => state },
  };
});

import { raceGatewayRoutes } from '../../../api/connection-strategy';
import {
  __resetProbeCoordinatorForTests,
  getLastProbeOutcome,
  runProbeRound,
  subscribeProbeOutcome,
} from '../probe-coordinator';

const mockedRace = vi.mocked(raceGatewayRoutes);

beforeEach(() => {
  __resetProbeCoordinatorForTests();
  memory.clear();
  mockedRace.mockReset();
});

afterEach(() => {
  __resetProbeCoordinatorForTests();
});

describe('runProbeRound', () => {
  it('runs the race once and broadcasts the outcome', async () => {
    mockedRace.mockResolvedValue({
      winner: 'lan',
      url: 'http://192.168.1.10:18790',
      latencyMs: 87,
      lan: { reachable: true, latencyMs: 87 },
      tunnel: { reachable: true, latencyMs: 412 },
    });

    const listener = vi.fn();
    const unsub = subscribeProbeOutcome(listener);

    const outcome = await runProbeRound('initial');
    expect(outcome.online).toBe(true);
    expect(outcome.result.winner).toBe('lan');
    expect(mockedRace).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it('returns the cached outcome within the freshness window', async () => {
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

    const outcome = await runProbeRound('initial');
    expect(outcome.online).toBe(false);
    expect(getLastProbeOutcome()?.online).toBe(false);
  });
});
