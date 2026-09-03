import type { MobilePrivacyDisclosure } from '@xopcai/gateway-contract';

export class DataSharingConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSharingConsentError';
  }
}

type ConsentDependencies = {
  activeGatewayId: () => string | null;
  loadDisclosure: (gatewayId: string) => Promise<MobilePrivacyDisclosure>;
  confirm: (disclosure: MobilePrivacyDisclosure, gatewayId: string) => Promise<boolean>;
  read: (key: string) => string | undefined;
  write: (key: string, value: string) => void;
  errorMessage: () => string;
};

const consentKey = (gatewayId: string) => `privacy.dataSharing.v1:${gatewayId}`;

export function createConsentController(deps: ConsentDependencies) {
  const pending = new Map<string, Promise<void>>();
  let generation = 0;

  function assertCurrent(gatewayId: string, expectedGeneration: number) {
    if (deps.activeGatewayId() !== gatewayId || generation !== expectedGeneration) {
      throw new DataSharingConsentError(deps.errorMessage());
    }
  }

  return {
    revoke(gatewayId: string) {
      generation += 1;
      deps.write(consentKey(gatewayId), 'denied');
    },
    async ensure(force = false, signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) throw new DataSharingConsentError(deps.errorMessage());
      const gatewayId = deps.activeGatewayId();
      if (!gatewayId) throw new DataSharingConsentError(deps.errorMessage());
      if (!force && deps.read(consentKey(gatewayId)) === 'denied') {
        throw new DataSharingConsentError(deps.errorMessage());
      }
      const expectedGeneration = generation;
      const disclosure = await deps.loadDisclosure(gatewayId);
      if (signal?.aborted) throw new DataSharingConsentError(deps.errorMessage());
      assertCurrent(gatewayId, expectedGeneration);
      const key = consentKey(gatewayId);
      if (!force && deps.read(key) === disclosure.revision) return;
      const pendingKey = `${gatewayId}:${disclosure.revision}:${expectedGeneration}`;
      const existing = pending.get(pendingKey);
      if (existing) return existing;
      const decision = (async () => {
        const accepted = await deps.confirm(disclosure, gatewayId);
        if (signal?.aborted) throw new DataSharingConsentError(deps.errorMessage());
        assertCurrent(gatewayId, expectedGeneration);
        if (!accepted) {
          deps.write(key, 'denied');
          throw new DataSharingConsentError(deps.errorMessage());
        }
        const latest = await deps.loadDisclosure(gatewayId);
        assertCurrent(gatewayId, expectedGeneration);
        if (signal?.aborted || latest.revision !== disclosure.revision) {
          throw new DataSharingConsentError(deps.errorMessage());
        }
        deps.write(key, disclosure.revision);
      })().finally(() => pending.delete(pendingKey));
      pending.set(pendingKey, decision);
      return decision;
    },
  };
}

const CONTENT_RESOURCES = new Set([
  'agent', 'sessions', 'tasks', 'notes', 'workspace', 'inbox', 'projects', 'files',
  'media', 'voice', 'clarify', 'automations', 'automation-runs', 'workflows', 'shares',
]);

/** Stored workspace content can also feed indexing, understanding and scheduled agent work. */
export function requiresDataSharingConsent(path: string, method: string): boolean {
  if (!['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) return false;
  const pathname = (path.startsWith('/') ? path : `/${path}`).split('?')[0];
  if (pathname === '/api/agent/abort'
    || /^\/api\/(?:automation-runs|workflows\/runs)\/[^/]+\/cancel$/.test(pathname)
    || /^\/api\/automations\/[^/]+\/pause$/.test(pathname)) return false;
  const [, prefix, resource] = pathname.split('/');
  return prefix === 'api' && CONTENT_RESOURCES.has(resource);
}
