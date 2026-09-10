import type { MobilePrivacyDisclosure } from '@xopcai/gateway-contract';

export type ConsentDecision = 'accepted' | 'declined' | 'cancelled';

export class DataSharingConsentError extends Error {
  constructor(
    message: string,
    readonly reason: 'consent-required' | 'disclosure-unavailable' = 'consent-required',
  ) {
    super(message);
    this.name = 'DataSharingConsentError';
  }
}

type ConsentDependencies = {
  activeGatewayId: () => string | null;
  loadDisclosure: (gatewayId: string) => Promise<MobilePrivacyDisclosure>;
  confirm: (disclosure: MobilePrivacyDisclosure, gatewayId: string) => Promise<ConsentDecision>;
  read: (key: string) => string | undefined;
  write: (key: string, value: string) => void;
  errorMessage: () => string;
};

const consentKey = (gatewayId: string) => `privacy.dataSharing.v2:${gatewayId}`;
const legacyConsentKey = (gatewayId: string) => `privacy.dataSharing.v1:${gatewayId}`;

export function createConsentController(deps: ConsentDependencies) {
  const pending = new Map<string, Promise<void>>();
  let generation = 0;

  function readDecision(gatewayId: string): string | undefined {
    const currentKey = consentKey(gatewayId);
    const current = deps.read(currentKey);
    if (current !== undefined) return current;

    // V1 could persist lifecycle/request cancellation as a denial. Preserve approvals only.
    const legacy = deps.read(legacyConsentKey(gatewayId));
    if (legacy && legacy !== 'denied') {
      deps.write(currentKey, legacy);
      return legacy;
    }
    return undefined;
  }

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
    async ensure(force = false): Promise<void> {
      const gatewayId = deps.activeGatewayId();
      if (!gatewayId) throw new DataSharingConsentError(deps.errorMessage());
      if (!force && readDecision(gatewayId) === 'denied') {
        throw new DataSharingConsentError(deps.errorMessage());
      }
      const expectedGeneration = generation;
      const disclosure = await deps.loadDisclosure(gatewayId);
      assertCurrent(gatewayId, expectedGeneration);
      const key = consentKey(gatewayId);
      if (!force && readDecision(gatewayId) === disclosure.revision) return;
      const pendingKey = `${gatewayId}:${disclosure.revision}:${expectedGeneration}`;
      const existing = pending.get(pendingKey);
      if (existing) return existing;
      const decision = (async () => {
        const result = await deps.confirm(disclosure, gatewayId);
        assertCurrent(gatewayId, expectedGeneration);
        if (result !== 'accepted') {
          if (result === 'declined') deps.write(key, 'denied');
          throw new DataSharingConsentError(deps.errorMessage());
        }
        const latest = await deps.loadDisclosure(gatewayId);
        assertCurrent(gatewayId, expectedGeneration);
        if (latest.revision !== disclosure.revision) {
          throw new DataSharingConsentError(deps.errorMessage());
        }
        deps.write(key, disclosure.revision);
      })().finally(() => pending.delete(pendingKey));
      pending.set(pendingKey, decision);
      return decision;
    },
  };
}

/** Cancels only the waiting request; the shared user decision keeps running and is persisted. */
export function waitForConsentDecision(
  start: () => Promise<void>,
  signal: AbortSignal | null | undefined,
  errorMessage: () => string,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DataSharingConsentError(errorMessage()));
  const decision = start();
  if (!signal) return decision;

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DataSharingConsentError(errorMessage()));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void decision.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

const CONTENT_RESOURCES = new Set([
  'agent', 'sessions', 'tasks', 'notes', 'workspace', 'inbox', 'projects', 'files',
  'media', 'voice', 'clarifications', 'automations', 'automation-runs', 'workflows', 'shares',
]);

/** Stored workspace content can also feed indexing, understanding and scheduled agent work. */
export function requiresDataSharingConsent(path: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(normalizedMethod)) return false;
  const pathname = (path.startsWith('/') ? path : `/${path}`).split('?')[0];
  // Opening an empty chat and choosing its runtime do not submit user content.
  if ((normalizedMethod === 'POST' && pathname === '/api/sessions')
    || (normalizedMethod === 'PATCH' && /^\/api\/sessions\/[^/]+\/agent-config$/.test(pathname))) {
    return false;
  }
  if (pathname === '/api/agent/abort'
    || /^\/api\/(?:automation-runs|workflows\/runs)\/[^/]+\/cancel$/.test(pathname)
    || /^\/api\/automations\/[^/]+\/pause$/.test(pathname)) return false;
  const [, prefix, resource] = pathname.split('/');
  return prefix === 'api' && CONTENT_RESOURCES.has(resource);
}
