import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
const tokenMemory = new Map<string, string>();

vi.mock('../../storage/mmkv', () => ({
  KEYS: {
    baseUrl: 'gateway.baseUrl',
    lanUrl: 'gateway.lanUrl',
    token: 'gateway.token',
    profiles: 'gateway.profiles',
    activeId: 'gateway.activeId',
    routeWinnerPrefix: 'gateway.routeWinner:',
    routeOverridePrefix: 'gateway.routeOverride:',
    pendingRunPrefix: 'xopc:pendingRun:',
    language: 'prefs.language',
    themePreference: 'prefs.themePreference',
    defaultAgentId: 'prefs.defaultAgentId',
  },
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
  pendingRunStorageKey: (sessionKey: string) => `xopc:pendingRun:${sessionKey}`,
}));

vi.mock('../../storage/gateway-token-storage', () => ({
  readGatewayToken: (profileId: string) => tokenMemory.get(profileId) ?? '',
  writeGatewayToken: (profileId: string, token: string) => {
    if (token) tokenMemory.set(profileId, token);
    else tokenMemory.delete(profileId);
  },
  deleteGatewayToken: (profileId: string) => {
    tokenMemory.delete(profileId);
  },
  __clearGatewayTokenMemoryForTests: () => {
    tokenMemory.clear();
  },
}));

vi.mock('../../api/connection-strategy', () => ({
  resolvePreferredBaseUrl: vi.fn(async (tunnel: string) => tunnel.replace(/\/+$/, '')),
  raceGatewayRoutes: vi.fn(async (tunnel: string, lan: string | undefined) => ({
    winner: lan ? 'lan' : tunnel ? 'tunnel' : 'none',
    url: lan ? lan.replace(/\/+$/, '') : tunnel ? tunnel.replace(/\/+$/, '') : '',
    lan: null,
    tunnel: null,
  })),
}));

import { KEYS } from '../../storage/mmkv';
import { useGatewayStore } from '../gateway-store';

function resetStore(): void {
  memory.clear();
  tokenMemory.clear();
  useGatewayStore.setState({
    profiles: [],
    activeGatewayId: null,
    baseUrl: '',
    lanUrl: null,
    activeBaseUrl: '',
    token: '',
    unauthorized: false,
  });
}

describe('useGatewayStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('migrates legacy single-gateway keys into a profile', () => {
    memory.set(KEYS.baseUrl, 'https://gw1.example.com/');
    memory.set(KEYS.lanUrl, 'http://192.168.1.10:18790');
    memory.set(KEYS.token, 'legacy-token');

    useGatewayStore.getState().hydrateFromStorage();

    const st = useGatewayStore.getState();
    expect(st.profiles).toHaveLength(1);
    expect(st.profiles[0]?.baseUrl).toBe('https://gw1.example.com');
    expect(st.profiles[0]?.lanUrl).toBe('http://192.168.1.10:18790');
    expect(st.profiles[0]?.token).toBe('legacy-token');
    expect(tokenMemory.get(st.profiles[0]?.id ?? '')).toBe('legacy-token');
    expect(st.activeGatewayId).toBe(st.profiles[0]?.id);
    expect(st.baseUrl).toBe('https://gw1.example.com');
    expect(st.lanUrl).toBe('http://192.168.1.10:18790');
    expect(st.activeBaseUrl).toBe('http://192.168.1.10:18790');
    expect(memory.has(KEYS.profiles)).toBe(true);
    expect(memory.has(KEYS.baseUrl)).toBe(false);
    expect(memory.has(KEYS.lanUrl)).toBe(false);
    expect(memory.has(KEYS.token)).toBe(false);
    expect(JSON.parse(memory.get(KEYS.profiles) ?? '[]')[0]?.token).toBe('');
  });

  it('adds, updates, switches, and removes profiles', () => {
    const firstId = useGatewayStore.getState().addProfile(
      { name: 'Home', baseUrl: 'https://home.example.com', token: 'a' },
      { setActive: true },
    );
    const secondId = useGatewayStore.getState().addProfile(
      { name: 'Office', baseUrl: 'https://office.example.com', token: 'b' },
      { setActive: false },
    );

    expect(useGatewayStore.getState().profiles).toHaveLength(2);
    expect(useGatewayStore.getState().activeGatewayId).toBe(firstId);
    expect(useGatewayStore.getState().baseUrl).toBe('https://home.example.com');

    useGatewayStore.getState().switchGateway(secondId);
    expect(useGatewayStore.getState().activeGatewayId).toBe(secondId);
    expect(useGatewayStore.getState().baseUrl).toBe('https://office.example.com');
    expect(useGatewayStore.getState().token).toBe('b');

    useGatewayStore.getState().updateProfile(secondId, { token: 'b2' });
    expect(useGatewayStore.getState().token).toBe('b2');
    expect(useGatewayStore.getState().profiles.find((p) => p.id === secondId)?.token).toBe('b2');
    expect(JSON.parse(memory.get(KEYS.profiles) ?? '[]').find((p: { id: string }) => p.id === secondId)?.token).toBe('');
    expect(tokenMemory.get(secondId)).toBe('b2');

    useGatewayStore.getState().removeProfile(firstId);
    expect(useGatewayStore.getState().profiles).toHaveLength(1);
    expect(useGatewayStore.getState().activeGatewayId).toBe(secondId);
    expect(tokenMemory.has(firstId)).toBe(false);
  });

  it('clears flat fields when the last profile is removed', () => {
    const id = useGatewayStore.getState().addProfile({
      baseUrl: 'https://only.example.com',
      token: 'x',
    });
    useGatewayStore.getState().removeProfile(id);

    const st = useGatewayStore.getState();
    expect(st.profiles).toHaveLength(0);
    expect(st.activeGatewayId).toBeNull();
    expect(st.baseUrl).toBe('');
    expect(st.token).toBe('');
  });

  it('finds profiles by normalized baseUrl', () => {
    useGatewayStore.getState().addProfile({
      baseUrl: 'https://dup.example.com/',
      token: 't',
    });

    const found = useGatewayStore.getState().findProfileByBaseUrl('https://dup.example.com');
    expect(found?.baseUrl).toBe('https://dup.example.com');
  });

  it('persists profiles and active id', () => {
    useGatewayStore.getState().addProfile({
      baseUrl: 'https://persist.example.com',
      token: 'save-me',
    });

    useGatewayStore.setState({
      profiles: [],
      activeGatewayId: null,
      baseUrl: '',
      lanUrl: null,
      activeBaseUrl: '',
      token: '',
      unauthorized: false,
    });
    useGatewayStore.getState().hydrateFromStorage();

    const st = useGatewayStore.getState();
    expect(st.profiles).toHaveLength(1);
    expect(st.baseUrl).toBe('https://persist.example.com');
    expect(st.token).toBe('save-me');
    expect(JSON.parse(memory.get(KEYS.profiles) ?? '[]')[0]?.token).toBe('');
  });

  it('apiUrl falls back to lanUrl when activeBaseUrl was cleared', () => {
    useGatewayStore.setState({
      profiles: [],
      activeGatewayId: 'gw1',
      baseUrl: '',
      lanUrl: 'http://192.168.1.44:18790',
      activeBaseUrl: '',
      token: 'tok',
      unauthorized: false,
    });

    expect(useGatewayStore.getState().apiUrl('/api/agent')).toBe(
      'http://192.168.1.44:18790/api/agent',
    );
  });
});
