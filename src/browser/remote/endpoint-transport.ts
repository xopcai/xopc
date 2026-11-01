import { createHash, randomUUID } from 'node:crypto';

import { REMOTE_BROWSER_CONTROL_TOOL, type RemoteBrowserCommand } from '@xopcai/browser-control-contract/remote';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';

import { executeExternalOperation, ExternalEffectNotAppliedError } from '../../capabilities/runtime/external-operations.js';
import { EndpointToolExecutionError } from '../../endpoint-tools/invocation-service.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Dedicated device path only. Missing or replaced devices never fall back to a server or legacy browser endpoint. */
export async function invokeRemoteBrowserCommand(endpoints: EndpointToolRuntime, endpointId: string, command: RemoteBrowserCommand, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const request = structuredClone(command);
  const endpoint = endpoints.registry.get(endpointId), authority = endpoint?.executionAuthority;
  const tool = endpoints.registry.getTool(endpointId, REMOTE_BROWSER_CONTROL_TOOL);
  if (!endpoint || endpoint.kind !== 'desktop' || !authority || !tool || endpoint.availability !== 'foreground'
    || authority.deviceId !== endpoint.principalId || authority.expiresAt <= Date.now()) throw new Error('BROWSER_REMOTE_AUTHORITY_INVALID');
  return executeExternalOperation({ principalId: authority.deviceId, capabilityId: `desktop-browser:${authority.deviceId}`,
    idempotencyKey: hash([request.owner, request.sessionId, request.actionId]), requestDigest: hash(request), descriptorDigest: tool.revision,
    surface: 'desktop-browser', recovery: 'manual' }, async operationId => {
    const current = endpoints.registry.get(endpointId), live = current?.executionAuthority;
    if (signal?.aborted || !current || !live || current.connectionId !== endpoint.connectionId || current.availability !== 'foreground'
      || current.principalId !== endpoint.principalId || live.deviceId !== authority.deviceId || live.gatewayId !== authority.gatewayId
      || live.grantId !== authority.grantId || live.authorizationRevision !== authority.authorizationRevision
      || live.connectionInstanceId !== authority.connectionInstanceId || live.expiresAt <= Date.now()
      || endpoints.registry.getTool(endpointId, REMOTE_BROWSER_CONTROL_TOOL)?.revision !== tool.revision) {
      throw new ExternalEffectNotAppliedError('Browser authority changed before dispatch');
    }
    try {
      return await endpoints.invocations.invoke({ endpointId, toolName: REMOTE_BROWSER_CONTROL_TOOL, descriptorRevision: tool.revision,
        toolCallId: randomUUID(), operationId, arguments: request as unknown as Record<string, unknown>, signal });
    } catch (error) {
      if (error instanceof EndpointToolExecutionError && (error.confirmedNoEffect || error.code === 'USER_DENIED')) {
        throw new ExternalEffectNotAppliedError(error.message, { cause: error });
      }
      throw error;
    }
  });
}
