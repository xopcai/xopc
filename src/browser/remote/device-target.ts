import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { getBoundEndpointPrincipalId } from '../../storage/sqlite/endpoint-principal-repository.js';

/** A selected task target wins over the message source, including when it becomes unavailable. */
export function remoteBrowserEndpoint(runtime: EndpointToolRuntime, owner: string, origin: TurnOrigin): string | undefined {
  const desktop = (id: string) => {
    const endpoint = runtime.registry.get(id);
    if (endpoint?.executionAuthority) return endpoint.kind === 'desktop';
    if (endpoint && endpoint.kind !== 'desktop') return false;
    const principalId = endpoint?.principalId ?? getBoundEndpointPrincipalId(id);
    return Boolean(principalId && getDevice(principalId)?.platform === 'desktop');
  };
  const binding = runtime.targets.get(owner);
  if (binding) {
    const endpoint = runtime.targets.resolve(owner);
    if (!endpoint) throw new Error('BROWSER_TARGET_OFFLINE');
    if (!desktop(endpoint.endpointId)) throw new Error('BROWSER_TARGET_UNSUPPORTED');
    return endpoint.endpointId;
  }
  return origin.type === 'endpoint' && desktop(origin.endpointId) ? origin.endpointId : undefined;
}
