import { createHmac, randomBytes } from 'node:crypto';
import { parseAppContextEnvelope, type ResolvedAppContext } from '@xopcai/gateway-contract';

import { appContextToAgentContext } from '../../agent/source-context/app-context.js';
import type { AgentSourceContext } from '../../agent/source-context/types.js';
import { canonicalCapabilityJson, CapabilityError, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { isBrowserSessionActive } from '../../storage/sqlite/browser-session-repository.js';
import type { ResolvedGatewayAuth } from '../auth.js';
import type { GatewayPrincipal } from '../security/gateway-principal.js';

export interface AppContextGrant {
  principal: GatewayPrincipal;
  authRevision: string;
}

const authorizationEpochKey = randomBytes(32);
function authRevision(auth: ResolvedGatewayAuth): string {
  // Never persist a guessable credential hash. Restart invalidates queued grants conservatively.
  return createHmac('sha256', authorizationEpochKey).update(canonicalCapabilityJson(JSON.parse(JSON.stringify(auth)))).digest('hex');
}

/** A queued read retains its original scope ceiling, but never a revoked identity. */
export async function checkAppContextAccess(
  source: AgentSourceContext,
  dispatcher: CapabilityDispatcher,
  auth: ResolvedGatewayAuth,
): Promise<void> {
  const grant = source.appContextGrant;
  if (!grant || grant.authRevision !== authRevision(auth) || !source.appContext) {
    throw new CapabilityError('FORBIDDEN', 'Application context authorization changed');
  }
  const { principal } = grant;
  let scopes = principal.scopes;
  if (principal.kind === 'device') {
    const device = principal.deviceId ? getDevice(principal.deviceId) : undefined;
    if (!device || device.revokedAt !== undefined || device.id !== principal.principalId) {
      throw new CapabilityError('FORBIDDEN', 'Application context device access was revoked');
    }
    scopes = scopes.filter(scope => device.scopes.includes(scope));
  }
  if (principal.browserSessionId && !isBrowserSessionActive(principal.browserSessionId, auth)) {
    throw new CapabilityError('FORBIDDEN', 'Application context browser session ended');
  }
  // Recheck visibility, not revisions: an accepted snapshot must not silently become newer text.
  for (const ref of source.appContext.resourceRefs) {
    const domain = ref.kind === 'local_app' ? 'local_apps' : `${ref.kind}s`;
    await dispatcher.call(`xopc.${domain}.get`, { id: ref.id }, {
      principalId: principal.principalId, scopes, surface: 'http', authorize: () => true,
    });
  }
}

export async function prepareAppContext(
  input: unknown,
  principal: GatewayPrincipal,
  auth: ResolvedGatewayAuth,
  dispatcher: CapabilityDispatcher,
  previous?: AgentSourceContext,
): Promise<AgentSourceContext> {
  let snapshot;
  try { snapshot = parseAppContextEnvelope(input); }
  catch { throw new CapabilityError('INVALID_INPUT', 'Invalid application context envelope'); }
  const grant = { principal: structuredClone(principal), authRevision: authRevision(auth) };
  if (previous) {
    if (canonicalCapabilityJson(previous.appContext) !== canonicalCapabilityJson(snapshot)
      || previous.appContextGrant?.principal.principalId !== principal.principalId) {
      throw new CapabilityError('REVISION_CONFLICT', 'Submission identity already belongs to another context');
    }
    // Check both the original grant and the current request; replay cannot elevate either.
    await checkAppContextAccess(previous, dispatcher, auth);
    await checkAppContextAccess({ ...previous, appContextGrant: grant }, dispatcher, auth);
    return structuredClone(previous);
  }
  const resolved = await dispatcher.call('xopc.context.resolve', snapshot, {
    principalId: principal.principalId, scopes: principal.scopes, surface: 'http', authorize: () => true,
  }) as ResolvedAppContext;
  const source = { ...appContextToAgentContext(resolved), appContextGrant: grant };
  await checkAppContextAccess(source, dispatcher, auth);
  return source;
}
