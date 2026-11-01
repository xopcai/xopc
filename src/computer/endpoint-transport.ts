import { createHash, randomUUID } from 'node:crypto';

import { COMPUTER_CONTROL_TOOL, REMOTE_COMPUTER_CONTROL_TOOL, type ComputerCommand } from '@xopcai/computer-control-contract';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';

import { executeExternalOperation, ExternalEffectNotAppliedError } from '../capabilities/runtime/external-operations.js';
import { EndpointToolExecutionError } from '../endpoint-tools/invocation-service.js';
import type { EndpointToolRuntime } from '../endpoint-tools/runtime.js';

const hash = (input: unknown) => createHash('sha256').update(canonicalJson(input)).digest('hex');

/** Keep local transport unchanged; independently authorized remote Computer commands always carry durable intent. */
export async function invokeComputerCommand(endpoints: EndpointToolRuntime, endpointId: string, command: ComputerCommand, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const endpoint = endpoints.registry.get(endpointId), authority = endpoint?.executionAuthority;
  const toolName = authority ? REMOTE_COMPUTER_CONTROL_TOOL : COMPUTER_CONTROL_TOOL;
  const tool = endpoints.registry.getTool(endpointId, toolName);
  if (!tool) throw new Error('COMPUTER_DESKTOP_UPGRADE_REQUIRED');
  const invoke = (operationId?: string) => endpoints.invocations.invoke({ endpointId, toolCallId: randomUUID(), toolName,
    arguments: command, descriptorRevision: tool.revision, ...(operationId ? { operationId } : {}), signal });
  if (!authority) return invoke();
  if (!endpoint || endpoint.availability !== 'foreground' || authority.deviceId !== endpoint.principalId
    || authority.expiresAt <= Date.now() || tool.descriptor.name !== REMOTE_COMPUTER_CONTROL_TOOL) throw new Error('COMPUTER_REMOTE_AUTHORITY_INVALID');
  // Open and action identities survive retries; observations are new explicitly requested operations, never a replayed input.
  const identity = command.op === 'act' ? command.envelope.actionId : command.op === 'open' ? 'open' : randomUUID();
  return executeExternalOperation({ principalId: authority.deviceId, capabilityId: `desktop-computer:${authority.deviceId}`,
    idempotencyKey: hash([command.owner, command.sessionId, command.op, identity]), requestDigest: hash(command),
    descriptorDigest: tool.revision, surface: 'desktop-computer', recovery: 'manual', leaseMs: 30000 }, async operationId => {
    const current = endpoints.registry.get(endpointId);
    if (signal?.aborted || !current || current.connectionId !== endpoint.connectionId || current.availability !== 'foreground'
      || current.executionAuthority?.connectionInstanceId !== authority.connectionInstanceId
      || current.principalId !== endpoint.principalId || current.executionAuthority.deviceId !== authority.deviceId
      || current.executionAuthority.gatewayId !== authority.gatewayId
      || current.executionAuthority.grantId !== authority.grantId || current.executionAuthority.authorizationRevision !== authority.authorizationRevision
      || current.executionAuthority.expiresAt <= Date.now() || endpoints.registry.getTool(endpointId, toolName)?.revision !== tool.revision) {
      throw new ExternalEffectNotAppliedError('Computer authority changed before dispatch');
    }
    try { return await invoke(operationId); }
    catch (error) {
      if (error instanceof EndpointToolExecutionError && (error.confirmedNoEffect || error.code === 'USER_DENIED')) {
        throw new ExternalEffectNotAppliedError(error.message, { cause: error });
      }
      throw error;
    }
  });
}
