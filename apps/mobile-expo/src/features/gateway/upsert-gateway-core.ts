import type { GatewayProfile } from '../../stores/gateway-types';

export type GatewayCredentials = {
  baseUrl: string;
  lanUrl?: string | null;
  token?: string;
  name?: string;
};

export type GatewayUpsertStore = {
  findProfileByBaseUrl: (url: string) => GatewayProfile | null;
  updateProfile: (id: string, patch: Partial<GatewayCredentials>) => void;
  switchGateway: (id: string) => void;
  addProfile: (
    input: GatewayCredentials,
    options?: { setActive?: boolean },
  ) => string;
};

export type UpsertGatewayResult = {
  profileId: string;
  created: boolean;
};

export function applyGatewayUpsert(
  store: GatewayUpsertStore,
  credentials: GatewayCredentials,
): UpsertGatewayResult {
  const existing = store.findProfileByBaseUrl(credentials.baseUrl);

  if (existing) {
    store.updateProfile(existing.id, {
      baseUrl: credentials.baseUrl,
      lanUrl: credentials.lanUrl,
      token: credentials.token,
      name: credentials.name,
    });
    store.switchGateway(existing.id);
    return { profileId: existing.id, created: false };
  }

  const profileId = store.addProfile(
    {
      baseUrl: credentials.baseUrl,
      lanUrl: credentials.lanUrl,
      token: credentials.token,
      name: credentials.name,
    },
    { setActive: true },
  );
  return { profileId, created: true };
}
