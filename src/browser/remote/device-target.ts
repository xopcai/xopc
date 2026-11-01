import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { getBoundEndpointPrincipalId } from '../../storage/sqlite/endpoint-principal-repository.js';

/** Fresh explicit device input wins over historical bindings. Revoked/offline desktop devices remain a device path and fail closed. */
export function remoteBrowserEndpoint(runtime: EndpointToolRuntime, owner: string, origin: TurnOrigin): string | undefined {
  const desktop = (id: string) => {
    const endpoint = runtime.registry.get(id);
    if (endpoint?.executionAuthority) return endpoint.kind === 'desktop';
    if (endpoint && endpoint.kind !== 'desktop') return false;
    const principalId = endpoint?.principalId ?? getBoundEndpointPrincipalId(id);
    return Boolean(principalId && getDevice(principalId)?.platform === 'desktop');
  };
  if (origin.type === 'endpoint' && desktop(origin.endpointId)) return origin.endpointId;
  const binding = runtime.bindings.get(owner);
  if (!binding) return undefined;
  const endpointId = runtime.bindings.resolve(owner)?.endpointId ?? binding.endpointId;
  return desktop(endpointId) ? endpointId : undefined;
}
