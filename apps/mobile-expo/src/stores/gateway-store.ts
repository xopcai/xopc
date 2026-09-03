import { create } from 'zustand';

import { deleteDeviceRefreshToken } from '../storage/device-credentials';
import { KEYS, storage } from '../storage/mmkv';
import { activeGatewayRoute, parseGatewayProfile, type GatewayProfile } from './gateway-types';

export type GatewayState = {
  connectionGeneration: number;
  profiles: GatewayProfile[];
  activeGatewayId: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: number;
  unauthorized: boolean;
  hydrateFromStorage: () => void;
  getActiveProfile: () => GatewayProfile | null;
  getActiveRouteUrl: () => string;
  apiUrl: (path: string) => string;
  savePairedProfile: (profile: GatewayProfile, accessToken: string, accessTokenExpiresAt: number) => void;
  renameProfile: (gatewayId: string, name: string) => void;
  removeProfile: (gatewayId: string) => void;
  activateProfile: (gatewayId: string) => void;
  selectRoute: (gatewayId: string, routeId: string) => void;
  setAccessToken: (token: string, expiresAt: number) => void;
  clearAccessToken: () => void;
  onUnauthorized: () => void;
};

function persistProfiles(profiles: GatewayProfile[], activeGatewayId: string | null): void {
  if (profiles.length === 0) {
    storage.delete(KEYS.profiles);
    storage.delete(KEYS.activeId);
    return;
  }
  storage.set(KEYS.profiles, JSON.stringify(profiles));
  if (activeGatewayId) storage.set(KEYS.activeId, activeGatewayId);
}

function readProfiles(): GatewayProfile[] {
  const raw = storage.getString(KEYS.profiles);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Invalid gateway profiles');
    const profiles = parsed.map(parseGatewayProfile);
    if (profiles.some((profile) => profile === null)) throw new Error('Obsolete gateway profiles');
    return profiles as GatewayProfile[];
  } catch {
    storage.delete(KEYS.profiles);
    storage.delete(KEYS.activeId);
    return [];
  }
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  connectionGeneration: 0,
  profiles: [],
  activeGatewayId: null,
  accessToken: null,
  accessTokenExpiresAt: 0,
  unauthorized: false,

  hydrateFromStorage: () => {
    const profiles = readProfiles();
    const storedId = storage.getString(KEYS.activeId) ?? null;
    const activeGatewayId = profiles.some((profile) => profile.gatewayId === storedId)
      ? storedId
      : profiles[0]?.gatewayId ?? null;
    set({ profiles, activeGatewayId, accessToken: null, accessTokenExpiresAt: 0, unauthorized: false, connectionGeneration: get().connectionGeneration + 1 });
    persistProfiles(profiles, activeGatewayId);
  },

  getActiveProfile: () => {
    const { profiles, activeGatewayId } = get();
    return profiles.find((profile) => profile.gatewayId === activeGatewayId) ?? null;
  },

  getActiveRouteUrl: () => activeGatewayRoute(get().getActiveProfile())?.url ?? '',

  apiUrl: (path) => {
    const route = get().getActiveRouteUrl();
    if (!route) throw new Error('No paired gateway is active');
    return `${route}${path.startsWith('/') ? path : `/${path}`}`;
  },

  savePairedProfile: (profile, accessToken, accessTokenExpiresAt) => {
    const profiles = [profile, ...get().profiles.filter((item) => item.gatewayId !== profile.gatewayId)];
    set({ profiles, activeGatewayId: profile.gatewayId, accessToken, accessTokenExpiresAt, unauthorized: false, connectionGeneration: get().connectionGeneration + 1 });
    persistProfiles(profiles, profile.gatewayId);
  },

  renameProfile: (gatewayId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const profiles = get().profiles.map((profile) => profile.gatewayId === gatewayId
      ? { ...profile, name: trimmed, updatedAt: Date.now() }
      : profile);
    set({ profiles });
    persistProfiles(profiles, get().activeGatewayId);
  },

  removeProfile: (gatewayId) => {
    const profiles = get().profiles.filter((profile) => profile.gatewayId !== gatewayId);
    deleteDeviceRefreshToken(gatewayId);
    const wasActive = get().activeGatewayId === gatewayId;
    const activeGatewayId = wasActive ? profiles[0]?.gatewayId ?? null : get().activeGatewayId;
    set({
      profiles,
      activeGatewayId,
      connectionGeneration: get().connectionGeneration + (wasActive ? 1 : 0),
      ...(wasActive ? { accessToken: null, accessTokenExpiresAt: 0, unauthorized: false } : {}),
    });
    persistProfiles(profiles, activeGatewayId);
  },

  activateProfile: (gatewayId) => {
    if (!get().profiles.some((profile) => profile.gatewayId === gatewayId)) return;
    set({ activeGatewayId: gatewayId, accessToken: null, accessTokenExpiresAt: 0, unauthorized: false, connectionGeneration: get().connectionGeneration + 1 });
    persistProfiles(get().profiles, gatewayId);
  },

  selectRoute: (gatewayId, routeId) => {
    const profiles = get().profiles.map((profile) => {
      if (profile.gatewayId !== gatewayId || !profile.routes.some((route) => route.id === routeId)) return profile;
      return { ...profile, activeRouteId: routeId, updatedAt: Date.now() };
    });
    set({ profiles });
    persistProfiles(profiles, get().activeGatewayId);
  },

  setAccessToken: (accessToken, accessTokenExpiresAt) => set({ accessToken, accessTokenExpiresAt, unauthorized: false }),
  clearAccessToken: () => set({ accessToken: null, accessTokenExpiresAt: 0 }),
  onUnauthorized: () => set({ unauthorized: true, accessToken: null, accessTokenExpiresAt: 0 }),
}));
