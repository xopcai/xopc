import { create } from 'zustand';

import { readAnyNetworkLastGoodRoute } from '../features/gateway/last-good-route';
import {
  readRouteOverride,
  writeRouteOverride,
  type RouteOverride,
} from '../features/gateway/route-override';
import { KEYS, storage } from '../storage/mmkv';
import {
  deleteGatewayToken,
  readGatewayToken,
  writeGatewayToken,
} from '../storage/gateway-token-storage';

import {
  buildGatewayProfile,
  gatewayProfileNameFromUrl,
  normalizeGatewayBaseUrl,
  preferredActiveBaseUrlFromFlat,
  resolveEffectiveGatewayBaseUrl,
  type GatewayProfile,
  type GatewayProfileInput,
} from './gateway-types';

export const DEFAULT_GATEWAY_BASE_URL = '';
export const GATEWAY_BASE_URL_PLACEHOLDER = 'http://192.168.x.x:18790';

export type GatewayState = {
  profiles: GatewayProfile[];
  activeGatewayId: string | null;
  baseUrl: string;
  lanUrl: string | null;
  activeBaseUrl: string;
  token: string;
  unauthorized: boolean;
  setBaseUrl: (v: string) => void;
  setLanUrl: (v: string | null) => void;
  setToken: (v: string) => void;
  refreshActiveBaseUrl: () => Promise<string>;
  hydrateFromStorage: () => void;
  persist: () => void;
  onUnauthorized: () => void;
  apiUrl: (path: string) => string;
  findProfileByBaseUrl: (url: string) => GatewayProfile | null;
  getActiveProfile: () => GatewayProfile | null;
  addProfile: (input: GatewayProfileInput) => string;
  updateProfile: (id: string, patch: Partial<GatewayProfileInput>) => void;
  removeProfile: (id: string) => void;
  activateProfile: (id: string) => void;
  /** Manual route override for the active profile. */
  routeOverride: RouteOverride;
  setRouteOverride: (override: RouteOverride) => Promise<void>;
};

function normalizeBaseUrl(raw: string): string {
  return normalizeGatewayBaseUrl(raw);
}

function flatFieldsFromProfile(profile: GatewayProfile | null): Pick<
  GatewayState,
  'baseUrl' | 'lanUrl' | 'token' | 'activeBaseUrl' | 'unauthorized' | 'routeOverride'
> {
  if (!profile) {
    return {
      baseUrl: '',
      lanUrl: null,
      token: '',
      activeBaseUrl: '',
      unauthorized: false,
      routeOverride: 'auto',
    };
  }
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  const lanUrl = profile.lanUrl ? normalizeBaseUrl(profile.lanUrl) : null;
  return {
    baseUrl,
    lanUrl,
    token: profile.token.trim(),
    activeBaseUrl: pickInitialActiveBaseUrl(profile.id, baseUrl, lanUrl),
    unauthorized: false,
    routeOverride: readRouteOverride(profile.id),
  };
}

/**
 * Pick the most-likely-reachable URL for the very first request after hydrate
 * before any probe completes. Order:
 *   1. Manual override — user pinned this route, honour it.
 *   2. Last-known winner across any network (skips dead-LAN-on-cellular).
 *   3. preferredActiveBaseUrlFromFlat (lan ?? base) — last resort.
 */
function pickInitialActiveBaseUrl(
  profileId: string,
  baseUrl: string,
  lanUrl: string | null,
): string {
  const override = readRouteOverride(profileId);
  if (override === 'lan' && lanUrl) return lanUrl;
  if (override === 'tunnel' && baseUrl) return baseUrl;
  const cached = readAnyNetworkLastGoodRoute(profileId);
  if (cached) {
    if (cached.kind === 'lan' && lanUrl && cached.url === lanUrl) return lanUrl;
    if (cached.kind === 'tunnel' && baseUrl && cached.url === baseUrl) return baseUrl;
  }
  return preferredActiveBaseUrlFromFlat({ baseUrl, lanUrl });
}

function parseProfilesJson(raw: string): GatewayProfile[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const fields = ['baseUrl', 'id', 'lanUrl', 'name', 'token', 'updatedAt'];
    if (!parsed.every((item): item is GatewayProfile => {
      if (typeof item !== 'object' || item == null) return false;
      const profile = item as Record<string, unknown>;
      return (
        Object.keys(profile).sort().join(',') === fields.join(',') &&
        typeof profile.id === 'string' && profile.id.trim().length > 0 &&
        typeof profile.name === 'string' && profile.name.trim().length > 0 &&
        typeof profile.baseUrl === 'string' && profile.baseUrl.trim().length > 0 &&
        (profile.lanUrl === null || typeof profile.lanUrl === 'string') &&
        typeof profile.token === 'string' &&
        typeof profile.updatedAt === 'number' && Number.isFinite(profile.updatedAt)
      );
    })) return null;
    return parsed.map((profile) => ({
      ...profile,
      name: profile.name.trim(),
      baseUrl: normalizeBaseUrl(profile.baseUrl),
      lanUrl: profile.lanUrl ? normalizeBaseUrl(profile.lanUrl) : null,
      token: '',
    }));
  } catch {
    return null;
  }
}

function profileForStorage(profile: GatewayProfile): GatewayProfile {
  return { ...profile, token: '' };
}

function hydrateProfileTokens(profiles: GatewayProfile[]): GatewayProfile[] {
  return profiles.map((profile) => ({ ...profile, token: readGatewayToken(profile.id) }));
}

function persistProfiles(profiles: GatewayProfile[], activeGatewayId: string | null): void {
  if (profiles.length > 0) {
    for (const profile of profiles) {
      writeGatewayToken(profile.id, profile.token);
    }
    storage.set(KEYS.profiles, JSON.stringify(profiles.map(profileForStorage)));
    if (activeGatewayId) storage.set(KEYS.activeId, activeGatewayId);
    else storage.delete(KEYS.activeId);
  } else {
    storage.delete(KEYS.profiles);
    storage.delete(KEYS.activeId);
  }
}

function syncActiveProfileFromFlat(
  profiles: GatewayProfile[],
  activeGatewayId: string | null,
  baseUrl: string,
  lanUrl: string | null,
  token: string,
): GatewayProfile[] {
  if (!activeGatewayId) return profiles;
  const idx = profiles.findIndex((p) => p.id === activeGatewayId);
  if (idx < 0) return profiles;
  const next = [...profiles];
  next[idx] = {
    ...next[idx],
    baseUrl: normalizeBaseUrl(baseUrl),
    lanUrl: lanUrl ? normalizeBaseUrl(lanUrl) : null,
    token: token.trim(),
    updatedAt: Date.now(),
  };
  return next;
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  profiles: [],
  activeGatewayId: null,
  baseUrl: '',
  lanUrl: null,
  activeBaseUrl: '',
  token: '',
  unauthorized: false,
  routeOverride: 'auto',

  setRouteOverride: async (override: RouteOverride) => {
    const { activeGatewayId, baseUrl, lanUrl } = get();
    if (!activeGatewayId) return;
    writeRouteOverride(activeGatewayId, override);
    // Update activeBaseUrl optimistically; the probe round below confirms.
    let nextActive = get().activeBaseUrl;
    if (override === 'lan' && lanUrl) nextActive = lanUrl;
    else if (override === 'tunnel' && baseUrl) nextActive = baseUrl;
    set({ routeOverride: override, activeBaseUrl: nextActive });
    const { runProbeRound } = await import('../features/gateway/probe-coordinator');
    await runProbeRound('manual', { force: true });
  },

  setBaseUrl: (v) => {
    const baseUrl = normalizeBaseUrl(v);
    const { profiles, activeGatewayId, lanUrl, token, activeBaseUrl } = get();
    set({
      baseUrl,
      unauthorized: false,
      activeBaseUrl: activeGatewayId
        ? preferredActiveBaseUrlFromFlat({ baseUrl, lanUrl })
        : activeBaseUrl,
      profiles: syncActiveProfileFromFlat(profiles, activeGatewayId, baseUrl, lanUrl, token),
    });
  },

  setLanUrl: (v) => {
    const lanUrl = v ? normalizeBaseUrl(v) : null;
    const { profiles, activeGatewayId, baseUrl, token, activeBaseUrl } = get();
    set({
      lanUrl,
      unauthorized: false,
      activeBaseUrl: activeGatewayId
        ? preferredActiveBaseUrlFromFlat({ baseUrl, lanUrl })
        : activeBaseUrl,
      profiles: syncActiveProfileFromFlat(profiles, activeGatewayId, baseUrl, lanUrl, token),
    });
  },

  setToken: (v) => {
    const token = v.trim();
    const { profiles, activeGatewayId, baseUrl, lanUrl } = get();
    set({
      token,
      unauthorized: false,
      profiles: syncActiveProfileFromFlat(profiles, activeGatewayId, baseUrl, lanUrl, token),
    });
  },

  refreshActiveBaseUrl: async () => {
    const { activeGatewayId, baseUrl, lanUrl } = get();
    const tunnel = normalizeBaseUrl(baseUrl);
    const lan = lanUrl ? normalizeBaseUrl(lanUrl) : '';
    const isStillActive = () => {
      const current = get();
      return (
        current.activeGatewayId === activeGatewayId &&
        normalizeBaseUrl(current.baseUrl) === tunnel &&
        (current.lanUrl ? normalizeBaseUrl(current.lanUrl) : '') === lan
      );
    };
    if (!tunnel && !lan) {
      if (isStillActive()) set({ activeBaseUrl: '' });
      return '';
    }
    const { runProbeRound } = await import('../features/gateway/probe-coordinator');
    const task = await runProbeRound('settings-saved', { force: true });
    const winnerUrl = task.result.url;
    if (
      winnerUrl &&
      (task.result.winner === 'lan' || task.result.winner === 'tunnel')
    ) {
      const resolved = normalizeBaseUrl(winnerUrl);
      if (isStillActive()) set({ activeBaseUrl: resolved });
      return resolved;
    }
    // Both unreachable — keep the previous best guess; don't poison the URL.
    if (!isStillActive()) return normalizeBaseUrl(get().activeBaseUrl);
    const fallback = normalizeBaseUrl(get().activeBaseUrl) || lan || tunnel;
    set({ activeBaseUrl: fallback });
    return fallback;
  },

  hydrateFromStorage: () => {
    const profilesJson = storage.getString(KEYS.profiles);
    if (profilesJson) {
      const profiles = hydrateProfileTokens(parseProfilesJson(profilesJson) ?? []);
      const storedActiveId = storage.getString(KEYS.activeId) ?? null;
      const activeGatewayId =
        storedActiveId && profiles.some((p) => p.id === storedActiveId)
          ? storedActiveId
          : (profiles[0]?.id ?? null);
      const activeProfile = profiles.find((p) => p.id === activeGatewayId) ?? null;
      set({
        profiles,
        activeGatewayId,
        ...flatFieldsFromProfile(activeProfile),
      });
      persistProfiles(profiles, activeGatewayId);
      return;
    }

    set({
      profiles: [],
      activeGatewayId: null,
      ...flatFieldsFromProfile(null),
    });
  },

  persist: () => {
    const { profiles, activeGatewayId } = get();
    persistProfiles(profiles, activeGatewayId);
  },

  onUnauthorized: () => {
    set({ unauthorized: true });
  },

  apiUrl: (path: string) => {
    const base = resolveEffectiveGatewayBaseUrl(get());
    if (!base) {
      throw new Error('Gateway base URL is not configured');
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  },

  findProfileByBaseUrl: (url: string) => {
    const normalized = normalizeBaseUrl(url);
    return get().profiles.find((p) => normalizeBaseUrl(p.baseUrl) === normalized) ?? null;
  },

  getActiveProfile: () => {
    const { profiles, activeGatewayId } = get();
    if (!activeGatewayId) return null;
    return profiles.find((p) => p.id === activeGatewayId) ?? null;
  },

  addProfile: (input) => {
    const profile = buildGatewayProfile(input);
    const profiles = [...get().profiles, profile];
    set({ profiles });
    get().persist();
    return profile.id;
  },

  updateProfile: (id, patch) => {
    const { profiles, activeGatewayId } = get();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;

    const current = profiles[idx];
    const baseUrl = patch.baseUrl != null ? normalizeBaseUrl(patch.baseUrl) : current.baseUrl;
    const updated: GatewayProfile = {
      ...current,
      name:
        patch.name !== undefined
          ? patch.name.trim() || gatewayProfileNameFromUrl(baseUrl)
          : current.name,
      baseUrl,
      lanUrl:
        patch.lanUrl !== undefined
          ? patch.lanUrl?.trim()
            ? normalizeBaseUrl(patch.lanUrl)
            : null
          : current.lanUrl,
      token: patch.token !== undefined ? patch.token.trim() : current.token,
      updatedAt: Date.now(),
    };

    const nextProfiles = [...profiles];
    nextProfiles[idx] = updated;
    const patchState: Partial<GatewayState> = { profiles: nextProfiles };
    if (activeGatewayId === id) {
      Object.assign(patchState, flatFieldsFromProfile(updated));
    }
    set(patchState);
    get().persist();
  },

  removeProfile: (id) => {
    const { profiles, activeGatewayId } = get();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;

    const nextProfiles = profiles.filter((p) => p.id !== id);
    deleteGatewayToken(id);
    if (activeGatewayId !== id) {
      set({ profiles: nextProfiles });
      get().persist();
      return;
    }

    const nextActive = nextProfiles[0]?.id ?? null;
    const nextProfile = nextActive ? (nextProfiles.find((p) => p.id === nextActive) ?? null) : null;
    set({
      profiles: nextProfiles,
      activeGatewayId: nextActive,
      ...flatFieldsFromProfile(nextProfile),
    });
    get().persist();
  },

  activateProfile: (id) => {
    const profile = get().profiles.find((p) => p.id === id);
    if (!profile) return;
    set({
      activeGatewayId: id,
      ...flatFieldsFromProfile(profile),
      unauthorized: false,
    });
    get().persist();
  },
}));
