import { randomUUID } from 'node:crypto';

import type { PlatformEvent } from './contracts.js';
import { PlatformRuntimeClient, type RuntimeCommand } from './client.js';

export interface RuntimeExecutionResult {
  output?: unknown;
}

export type RuntimeCommandHandler = (command: RuntimeCommand, signal: AbortSignal) => Promise<RuntimeExecutionResult>;

class RuntimeCancellation extends Error {
  constructor() {
    super('Run cancellation requested by platform');
    this.name = 'RuntimeCancellation';
  }
}

function commandIdentity(command: RuntimeCommand): { organizationId: string; workspaceId: string; traceId: string; runtimeId: string } {
  const { organizationId, workspaceId, traceId, runtimeId } = command.payload;
  if ([organizationId, workspaceId, traceId, runtimeId].some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('Runtime command is missing tenant or trace identity');
  }
  return { organizationId, workspaceId, traceId, runtimeId } as ReturnType<typeof commandIdentity>;
}

function event(command: RuntimeCommand, type: string, sequence: number, payload: Record<string, unknown>): PlatformEvent {
  const identity = commandIdentity(command);
  return {
    schemaVersion: '1',
    eventId: `event_${randomUUID()}`,
    type,
    time: new Date().toISOString(),
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    runId: command.runId,
    traceId: identity.traceId,
    sequence,
    producer: identity.runtimeId,
    payload,
  };
}

export async function processRuntimeCommand(
  client: PlatformRuntimeClient,
  handler: RuntimeCommandHandler,
): Promise<'idle' | 'completed' | 'failed' | 'cancelled'> {
  const command = await client.lease();
  if (!command) return 'idle';
  await client.report(event(command, 'xopc.run.started', 1, {}), command.leaseToken);
  const controller = new AbortController();
  let renewing = false;
  let renewalInFlight: Promise<void> = Promise.resolve();
  const renewalIntervalMs = Math.max(1_000, Math.min(30_000, Math.floor((command.leaseExpiresAt - Date.now()) / 3)));
  const renewal = setInterval(() => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    renewalInFlight = client.renew(command.id, command.leaseToken)
      .then((result) => {
        if (result.cancelRequested) controller.abort(new RuntimeCancellation());
      })
      .catch((error) => controller.abort(error))
      .finally(() => { renewing = false; });
  }, renewalIntervalMs);
  renewal.unref?.();
  try {
    const result = await handler(command, controller.signal);
    await renewalInFlight;
    if (controller.signal.aborted) throw controller.signal.reason;
    await client.report(event(command, 'xopc.run.succeeded', 2, { output: result.output }), command.leaseToken);
    return 'completed';
  } catch (error) {
    const effectiveError = controller.signal.aborted ? controller.signal.reason : error;
    const cancelled = effectiveError instanceof RuntimeCancellation;
    await client.report(event(command, cancelled ? 'xopc.run.cancelled' : 'xopc.run.failed', 2,
      cancelled ? {} : { error: effectiveError instanceof Error ? effectiveError.message : 'Runtime command failed' }), command.leaseToken);
    return cancelled ? 'cancelled' : 'failed';
  } finally {
    clearInterval(renewal);
    await renewalInFlight;
  }
}
