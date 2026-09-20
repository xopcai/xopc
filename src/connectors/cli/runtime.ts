import { getConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import type { Config } from '../../config/schema.js';
import type { ConnectorConnection } from '../types.js';
import { requireCliInstance } from './authorization.js';
import { verifyInstalledCli } from './installer.js';
import { startCliProcess } from './process.js';
import { normalizeCliResult, parseJson, validateActionInput } from './protocol.js';
import type { CliAction, JsonObject } from './types.js';

const contracts = new Map<string, { expiresAt: number; action: CliAction }>();

export async function describeCliAction(config: Config, instanceId: string, connection: ConnectorConnection, actionId: string): Promise<CliAction> {
  const adapter = requireCliInstance(config, instanceId);
  if (!adapter.curatedActions[actionId]) throw new Error('CLI action is not enabled.');
  if (connection.provider !== 'cli' || connection.metadata.runtimeInstanceId !== instanceId || connection.status !== 'active') throw new Error('CLI connection is not available.');
  const staticAction = adapter.staticActions?.[actionId];
  if (staticAction) return staticAction;
  const key = JSON.stringify([instanceId, connection.id, connection.updatedAt, adapter.version, adapter.binaryVersion, actionId]);
  const cached = contracts.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.action;
  const executable = await verifyInstalledCli(adapter);
  const probe = await startCliProcess({ adapter, executable, contextId: String(connection.metadata.contextId), args: adapter.schemaArgs(actionId) });
  const output = await probe.completion;
  if (output.exitCode !== 0 || output.outputTruncated) throw new Error('Could not retrieve CLI action schema.');
  const action = adapter.decodeSchema(actionId, parseJson(output.stdout));
  if (contracts.size >= 256) contracts.clear();
  contracts.set(key, { action, expiresAt: Date.now() + 60_000 });
  return action;
}

export async function verifyCliConnection(config: Config, instanceId: string, connection: ConnectorConnection, signal?: AbortSignal) {
  const adapter = requireCliInstance(config, instanceId);
  if (connection.provider !== 'cli' || connection.status !== 'active' || connection.metadata.runtimeInstanceId !== instanceId) throw new Error('CLI connection is unavailable.');
  const executable = await verifyInstalledCli(adapter);
  const probe = await startCliProcess({ adapter, executable, contextId: String(connection.metadata.contextId), args: adapter.statusArgs, signal });
  const output = await probe.completion;
  if (output.timedOut || output.aborted || output.outputTruncated) throw new Error('CLI identity verification failed.');
  const identity = adapter.decodeIdentity(output);
  if (identity.key !== getConnectorAccount(connection.accountId!)?.identityKey) throw new Error('CLI identity changed. Reauthorize the selected account.');
  return { adapter, executable, identity };
}

const queues = new Map<string, Promise<void>>();

export async function executeCliAction(config: Config, instanceId: string, connection: ConnectorConnection, action: CliAction, input: JsonObject, signal?: AbortSignal, beforeExecute?: () => void) {
  const contextId = String(connection.metadata.contextId);
  const previous = queues.get(contextId) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  queues.set(contextId, pending);
  await previous;
  try {
    signal?.throwIfAborted();
    validateActionInput(action, input);
    const { adapter, executable, identity } = await verifyCliConnection(config, instanceId, connection, signal);
    if (action.requiredScopes.some(scope => !identity.scopes.includes(scope)) || (action.anyScopes?.length && !action.anyScopes.some(scope => identity.scopes.includes(scope)))) throw new Error('CLI account is missing required scopes.');
    if (adapter.curatedActions[action.id] !== action.scope) throw new Error('CLI action contract changed.');
    const handle = await startCliProcess({ adapter, executable, contextId, args: adapter.actionArgs(action, input), signal, beforeSpawn: () => { requireCliInstance(config, instanceId); beforeExecute?.(); } });
    return normalizeCliResult(adapter, await handle.completion, action.scope);
  } finally {
    release();
    if (queues.get(contextId) === pending) queues.delete(contextId);
  }
}
