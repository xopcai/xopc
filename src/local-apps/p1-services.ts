import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config/schema.js';
import type { FileSpaceService } from '../files/file-service.js';
import { parseFileResourceId } from '../files/file-service.js';
import { checkedFilePath } from '../agent/sandbox/fileAccess.js';
import { ExternalToolService } from '../agent/external-tools/service.js';
import { CliToolProvider } from '../agent/external-tools/cliProvider.js';
import { ComposioToolProvider } from '../agent/external-tools/composio-provider.js';
import type { ExternalToolProvider } from '../agent/external-tools/types.js';
import { parseExternalToolRef } from '../agent/external-tools/refs.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';
import { listConnectorInstances } from '../connectors/instances.js';
import { getCliAdapter } from '../connectors/cli/adapterRegistry.js';
import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { decideConnectorApproval, getConnectorApproval, getConnectorConnection, listConnectorActionMetadata, listConnectorConnections } from '../storage/sqlite/connector-repository.js';
import { canonicalCapabilityJson, CapabilityError, defineAtomicCapability, defineReadCapability, type CapabilityContext, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import { executeExternalOperation, ExternalEffectNotAppliedError } from '../capabilities/runtime/external-operations.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import type { LocalAppService } from './service.js';
import type { LocalAppResourceScopes } from '@xopcai/gateway-contract';
type ConnectorBinding = Extract<LocalAppResourceScopes['connectors'], { mode: 'selected' }>['bindings'][number];

const LIMIT = 512 * 1024;
const connectorInput = z.strictObject({ toolRef: z.string().min(1).max(1024), accountId: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.json()).default({}) });
const exportInput = z.strictObject({ name: z.string().trim().min(1).max(120).regex(/^[^/\\\u0000-\u001f]+$/),
  encoding: z.enum(['utf8', 'base64']).default('utf8'), content: z.string().max(750000) });
const resultSchema = z.object({ id: z.uuid(), kind: z.enum(['connector', 'export']), status: z.enum(['pending', 'approved', 'rejected', 'unknown']),
  expiresAt: z.number(), result: z.json().optional() });
export type AppResourceRequest = z.infer<typeof resultSchema> & { extensionId: string; manifestDigest: string; grantRevision: string; releaseId: string;
  digest: string; input: z.infer<typeof connectorInput> | z.infer<typeof exportInput>; decision?: boolean; capabilityId?: string;
  binding?: ConnectorBinding; accountLabel?: string; reviewerPrincipalId?: string };
const requests = () => new DurableState<AppResourceRequest>('local-app-resource-requests');
const active = new Map<string, number>();
async function connectorLease<T>(context: CapabilityContext, execute: (context: CapabilityContext) => Promise<T>): Promise<T> {
  const extensionId = context.localApp?.extensionId;
  if (!extensionId || (active.get(extensionId) ?? 0) >= 4 || [...active.values()].reduce((a, b) => a + b, 0) >= 16) throw new CapabilityError('UNAVAILABLE', 'Connector capacity reached');
  active.set(extensionId, (active.get(extensionId) ?? 0) + 1);
  const controller = new AbortController();
  const abort = () => controller.abort(new CapabilityError('CANCELLED', 'Connector request ended'));
  const assertCurrent = () => { context.assertCurrent?.(); controller.signal.throwIfAborted(); };
  context.signal?.addEventListener('abort', abort, { once: true }); if (context.signal?.aborted) abort();
  const deadline = setTimeout(abort, 30000);
  const guard = setInterval(() => { try { assertCurrent(); } catch (error) { controller.abort(error); } }, 100);
  let rejectAbort!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new CapabilityError('CANCELLED', 'Connector request stopped; reconcile any uncertain write'));
  controller.signal.addEventListener('abort', onAbort, { once: true }); if (controller.signal.aborted) onAbort();
  const pending = Promise.resolve().then(() => { assertCurrent(); return execute({ ...context, signal: controller.signal, assertCurrent }); });
  const release = () => { const count = (active.get(extensionId) ?? 1) - 1; if (count) active.set(extensionId, count); else active.delete(extensionId); };
  void pending.then(release, release);
  try { return await Promise.race([pending, cancelled]); }
  finally { clearTimeout(deadline); clearInterval(guard); context.signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort); }
}
const hash = (input: unknown) => createHash('sha256').update(canonicalCapabilityJson(JSON.parse(JSON.stringify(input)))).digest('hex');
export type LocalAppP1Deps = { getConfig: () => Config; getFiles: () => FileSpaceService;
  getProviders?: () => ExternalToolProvider[] };

function providers(deps: LocalAppP1Deps): ExternalToolProvider[] {
  return deps.getProviders?.() ?? [new CliToolProvider({ getConfig: deps.getConfig, getCurrentContext: () => null, agentId: getDefaultAgentId() }),
    new ComposioToolProvider({ getConfig: deps.getConfig, getCurrentContext: () => null, agentId: getDefaultAgentId() })];
}
function toolScope(deps: LocalAppP1Deps, connectorId: string, toolRef: string): 'read' | 'write' | undefined {
  if (toolRef.startsWith('cli:')) {
    const ref = parseExternalToolRef(toolRef, 'cli');
    const instance = ref && listConnectorInstances(deps.getConfig()).find(item => item.connectorId === connectorId && item.instanceId === ref.namespace);
    const scope = instance?.materialized.type === 'cli' ? getCliAdapter(instance.materialized.adapterId)?.curatedActions[ref!.toolName] : undefined;
    return scope === 'read' || scope === 'write' ? scope : undefined;
  }
  const ref = parseExternalToolRef(toolRef, 'composio');
  const action = ref && listConnectorActionMetadata(connectorId).find(item => item.actionId === ref.toolName && item.curated);
  return action && (action.scope === 'read' || action.scope === 'write') ? action.scope : undefined;
}
function connectionCurrent(accountId: string, connectionId: string, connectorId: string) {
  const account = getConnectorAccount(accountId), connection = getConnectorConnection(connectionId);
  if (!account || account.currentConnectionId !== connectionId || !connection || connection.accountId !== accountId
    || connection.connectorId !== connectorId || connection.status !== 'active' || connection.principalId !== 'local-owner') {
    throw new CapabilityError('FORBIDDEN', 'Selected connector account is no longer active');
  }
  return connection;
}
async function scopedTool(deps: LocalAppP1Deps, binding: { toolRef: string; connectorId: string; accountId: string; connectionId: string }) {
  connectionCurrent(binding.accountId, binding.connectionId, binding.connectorId);
  const source = binding.toolRef.split(':')[0];
  const provider = providers(deps).find(item => item.source === source);
  if (!provider || !['cli', 'composio'].includes(source)) throw new CapabilityError('FORBIDDEN', 'Unsupported connector source');
  const service = new ExternalToolService([{ ...provider, source: provider.source,
    search: () => Promise.resolve([]), describe: ref => provider.describe(ref, { connectorId: binding.connectorId, accountId: binding.accountId }),
    execute: provider.execute.bind(provider) }]);
  const descriptor = (await service.describe([binding.toolRef])).tools[0];
  const scope = toolScope(deps, binding.connectorId, binding.toolRef);
  if (!descriptor || !scope || descriptor.readOnly !== (scope === 'read')) throw new CapabilityError('FORBIDDEN', 'A host-curated connector contract is required');
  connectionCurrent(binding.accountId, binding.connectionId, binding.connectorId);
  return { service, descriptor, scope };
}
export async function localAppConnectorOptions(deps: LocalAppP1Deps) {
  const items = [];
  for (const connection of listConnectorConnections({ principalId: 'local-owner' }).slice(0, 20)) {
    if (!connection.accountId || connection.status !== 'active' || getConnectorAccount(connection.accountId)?.currentConnectionId !== connection.id) continue;
    for (const provider of providers(deps).filter(item => item.source === connection.provider)) {
      const hits = await provider.search('', { connectorId: connection.connectorId, accountId: connection.accountId });
      for (const hit of hits.slice(0, 100)) {
        try {
          const binding = { toolRef: hit.toolRef, connectorId: connection.connectorId, accountId: connection.accountId, connectionId: connection.id };
          const { descriptor, scope } = await scopedTool(deps, binding);
          items.push({ id: hash(binding), title: `${getConnectorAccount(connection.accountId)?.label ?? connection.accountId} · ${hit.title} (${scope})`,
            binding: { ...binding, revision: descriptor.revision, scope } });
        } catch { /* Unavailable contracts are not grant options. */ }
        if (items.length >= 100) return items;
      }
    }
  }
  return items;
}
async function connectorAccess(deps: LocalAppP1Deps, input: z.infer<typeof connectorInput>, context: CapabilityContext, scope?: 'read' | 'write') {
  if (Buffer.byteLength(JSON.stringify(input.arguments)) > LIMIT) throw new CapabilityError('INVALID_INPUT', 'Connector arguments exceed 512 KiB');
  const grants = context.localApp?.resourceScopes.connectors;
  const binding = grants?.mode === 'selected' ? grants.bindings.find(item => item.toolRef === input.toolRef && item.accountId === input.accountId) : undefined;
  if (!binding || scope && binding.scope !== scope) throw new CapabilityError('FORBIDDEN', 'Connector action and account have not been approved');
  const current = await scopedTool(deps, binding);
  context.assertCurrent?.();
  if (current.descriptor.revision !== binding.revision || current.scope !== binding.scope) throw new CapabilityError('CONTRACT_CHANGED', 'Connector contract changed; review permissions again');
  const inspect = (value: unknown, depth = 0) => {
    if (depth > 20) throw new CapabilityError('INVALID_INPUT', 'Connector arguments are too deeply nested');
    if (Array.isArray(value)) { for (const item of value) inspect(item, depth + 1); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/xopc|authorization|cookie|password|api[_-]?key|access[_-]?token|secretref/i.test(key)) throw new CapabilityError('INVALID_INPUT', 'Applications cannot provide credentials or host connector controls');
      inspect(item, depth + 1);
    }
  };
  inspect(input.arguments);
  return { ...current, binding };
}
function connectorArguments(input: z.infer<typeof connectorInput>) {
  return { ...input.arguments, xopcAccountId: input.accountId, ...(input.toolRef.startsWith('cli:') ? { xopcExportResult: false } : {}) };
}
function boundedResult(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json ?? '') > LIMIT) throw new Error('Connector result exceeds its size limit');
  return z.json().parse(JSON.parse(json ?? 'null'));
}
function requestRecord(context: CapabilityContext, kind: AppResourceRequest['kind'], input: AppResourceRequest['input'], capabilityId?: string) {
  if (kind === 'connector' && Buffer.byteLength(JSON.stringify(input)) > LIMIT) throw new CapabilityError('INVALID_INPUT', 'Resource request exceeds 512 KiB');
  const app = context.localApp;
  if (!app?.manifestDigest || !app.grantRevision || !app.releaseId) throw new CapabilityError('FORBIDDEN', 'Installed app authority is required');
  for (const [id, value] of requests()) if (value.expiresAt <= Date.now()) requests().delete(id);
  if (requests().values().filter(item => item.extensionId === app.extensionId).length >= 50) throw new CapabilityError('UNAVAILABLE', 'Close an existing resource request first');
  const connector = input as z.infer<typeof connectorInput>;
  const binding = kind === 'connector' && app.resourceScopes.connectors.mode === 'selected'
    ? app.resourceScopes.connectors.bindings.find(item => item.accountId === connector.accountId && item.toolRef === connector.toolRef) : undefined;
  if (kind === 'connector' && !binding) throw new CapabilityError('FORBIDDEN', 'Connector binding is required');
  const record: AppResourceRequest = { id: randomUUID(), kind, extensionId: app.extensionId, manifestDigest: app.manifestDigest,
    grantRevision: app.grantRevision, releaseId: app.releaseId, input, capabilityId, binding,
    accountLabel: binding ? getConnectorAccount(binding.accountId)?.label : undefined,
    digest: hash({ kind, input, binding }), status: 'pending', expiresAt: Date.now() + 15 * 60000 };
  requests().set(record.id, record); return record;
}
export function readAppResourceRequest(extensionId: string, id: string) {
  const record = requests().get(id);
  if (!record || record.extensionId !== extensionId) throw new CapabilityError('NOT_FOUND', 'Resource request not found');
  return record;
}
export function assertResourceRequest(apps: Pick<LocalAppService, 'getCapabilityAccess'>, record: AppResourceRequest) {
  if (record.expiresAt <= Date.now()) throw new CapabilityError('FORBIDDEN', 'Resource request expired');
  const access = apps.getCapabilityAccess(record.extensionId, record.manifestDigest, record.grantRevision);
  const capability = record.kind === 'export' ? 'xopc.files.propose_export' : record.capabilityId ?? 'xopc.connectors.propose_write';
  if (access.releaseId !== record.releaseId || !access.bindings.some(item => item.id === capability)) throw new CapabilityError('FORBIDDEN', 'Resource request authority changed');
  if (record.kind === 'export' && !access.resourceScopes.filesExport) throw new CapabilityError('FORBIDDEN', 'File export is not authorized');
  return access;
}
export async function resolveAppResourceRequest(deps: LocalAppP1Deps, apps: Pick<LocalAppService, 'getCapabilityAccess'>,
  extensionId: string, id: string, digest: string, approve: boolean, caller: CapabilityContext) {
  caller.assertCurrent?.();
  const record = readAppResourceRequest(extensionId, id);
  if (record.digest !== digest) throw new CapabilityError('CONTRACT_CHANGED', 'Resource request changed');
  if (record.status !== 'pending') return resultSchema.parse(record);
  const access = assertResourceRequest(apps, record);
  if (record.decision !== undefined && record.decision !== approve) throw new CapabilityError('REVISION_CONFLICT', 'A different decision is already being applied');
  if (!approve) return resultSchema.parse(requests().update(id, current => {
    if (!current || current.extensionId !== extensionId) throw new CapabilityError('NOT_FOUND', 'Resource request not found');
    if (current.digest !== digest) throw new CapabilityError('CONTRACT_CHANGED', 'Resource request changed');
    if (current.status !== 'pending') return { value: current, result: current };
    assertResourceRequest(apps, current);
    if (current.decision === true) throw new CapabilityError('REVISION_CONFLICT', 'Approval is already being applied');
    const next = { ...current, status: 'rejected' as const, decision: false, reviewerPrincipalId: caller.principalId };
    return { value: next, result: next };
  }));
  const context: CapabilityContext = { ...caller, surface: 'extension', localApp: { extensionId, ...access, manifestDigest: record.manifestDigest },
    assertCurrent: () => { caller.assertCurrent?.(); assertResourceRequest(apps, record); } };
  if (record.kind === 'export') return resultSchema.parse(requests().update(id, current => {
    if (!current || current.extensionId !== extensionId) throw new CapabilityError('NOT_FOUND', 'Resource request not found');
    if (current.digest !== digest) throw new CapabilityError('CONTRACT_CHANGED', 'Resource request changed');
    if (current.status !== 'pending') return { value: current, result: current };
    context.assertCurrent?.();
    const next = { ...current, status: 'approved' as const, decision: true, reviewerPrincipalId: caller.principalId };
    return { value: next, result: next };
  }));
  const input = record.input as z.infer<typeof connectorInput>;
  const tool = await connectorLease(context, lease => connectorAccess(deps, input, lease, record.capabilityId === 'xopc.connectors.read' ? 'read' : 'write'));
  if (hash(tool.binding) !== hash(record.binding)) throw new CapabilityError('CONTRACT_CHANGED', 'Connector binding changed');
  const claimed = requests().update(id, current => {
    if (!current || current.extensionId !== extensionId) throw new CapabilityError('NOT_FOUND', 'Resource request not found');
    if (current.digest !== digest) throw new CapabilityError('CONTRACT_CHANGED', 'Resource request changed');
    if (current.status !== 'pending') return { value: current, result: current };
    context.assertCurrent?.();
    if (current.decision === false) throw new CapabilityError('REVISION_CONFLICT', 'Resource request was rejected');
    const next = { ...current, decision: true, reviewerPrincipalId: current.reviewerPrincipalId ?? caller.principalId };
    return { value: next, result: next };
  });
  if (claimed.status !== 'pending') return resultSchema.parse(claimed);
  let result: z.infer<ReturnType<typeof z.json>>;
  // The effect belongs to the request, independently of its host reviewer.
  try { result = await executeExternalOperation({ principalId: `local-app:${extensionId}`, capabilityId: 'xopc.connectors.propose_write',
    idempotencyKey: `app-resource:${id}`, requestDigest: hash(record.input), descriptorDigest: hash(tool.binding), surface: 'extension', recovery: 'manual' }, async operationId => connectorLease(context, async lease => {
    const authorize = () => { lease.assertCurrent?.(); connectionCurrent(tool.binding.accountId, tool.binding.connectionId, tool.binding.connectorId); };
    try { authorize(); } catch (cause) { throw new ExternalEffectNotAppliedError('Connector request was not submitted', { cause }); }
    const args = connectorArguments(input);
    const invoke = (approvalId?: string) => tool.service.execute({ toolRef: input.toolRef, revision: tool.descriptor.revision, arguments: args, approvalId,
      context: { toolCallId: operationId, signal: lease.signal, authorize } });
    let output = await invoke();
    const pending = JSON.parse(output.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as { status?: string; approvalId?: string };
    if (pending.status === 'confirmation_required' && pending.approvalId) {
      const approval = getConnectorApproval(pending.approvalId);
      const actionId = parseExternalToolRef(input.toolRef, input.toolRef.split(':')[0])?.toolName;
      if (!approval || approval.principalId !== 'local-owner' || approval.connectorId !== tool.binding.connectorId || approval.connectionId !== tool.binding.connectionId
        || approval.scope !== tool.scope || approval.actionId !== actionId) throw new Error('Connector confirmation identity changed');
      authorize(); decideConnectorApproval(approval.id, 'approved'); output = await invoke(approval.id);
    }
    authorize();
    const completed = JSON.parse(output.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as { status?: string; outcome?: string; result?: unknown };
    if (!completed || typeof completed !== 'object' || Array.isArray(completed)
      || (completed.outcome ? completed.outcome !== 'success' : !Object.hasOwn(completed, 'result'))) throw new Error('Connector did not report a completed execution');
    return boundedResult(output);
  }), value => z.json().parse(value)); } catch (error) {
    if (error instanceof CapabilityError && error.code === 'OUTCOME_UNKNOWN') {
      requests().set(id, { ...claimed, status: 'unknown', decision: true, result: { code: error.code, operationId: error.operationId ?? null } });
    }
    throw error;
  }
  const next = { ...claimed, status: 'approved' as const, result }; requests().set(id, next); return resultSchema.parse(next);
}
function selectedFilePath(root: string, selected: string): string {
  const parts = relative(root, selected).split(sep);
  let path = root;
  for (const part of parts) {
    path = resolve(path, part);
    if (lstatSync(path).isSymbolicLink()) throw new CapabilityError('FORBIDDEN', 'Selected file path contains a symbolic link');
  }
  if (checkedFilePath(root, selected, 'read') !== selected) throw new CapabilityError('FORBIDDEN', 'Selected file path changed');
  return selected;
}

export function registerLocalAppP1Capabilities(dispatcher: CapabilityDispatcher, deps: LocalAppP1Deps) {
  dispatcher.register(defineReadCapability({ id: 'xopc.files.read', majorVersion: 1, effect: 'read', surfaces: ['extension'], scopes: ['workspace.read'],
    description: 'Read one explicitly selected regular file, at most 512 KiB; never returns host paths or download credentials.',
    input: z.strictObject({ id: z.string().min(1).max(4096), encoding: z.enum(['utf8', 'base64']).default('utf8') }),
    output: z.object({ id: z.string(), name: z.string(), mimeType: z.string(), size: z.number(), sha256: z.string(), encoding: z.enum(['utf8', 'base64']), content: z.string() }),
    async execute({ id, encoding }, context) {
      const locator = parseFileResourceId(id);
      if (locator.spaceId.startsWith('host-')) throw new CapabilityError('FORBIDDEN', 'Arbitrary host file spaces are unavailable to apps');
      const { space, resource, absolutePath } = await deps.getFiles().resource(id);
      const parts = relative(space.root, absolutePath).split(sep);
      if (resource.kind !== 'file' || parts.some(part => part.startsWith('.')) || resolve(space.root, locator.relativePath) !== absolutePath) throw new CapabilityError('FORBIDDEN', 'Hidden files and symbolic links are unavailable to apps');
      const path = selectedFilePath(space.root, absolutePath);
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await file.stat();
        const current = await stat(selectedFilePath(space.root, absolutePath));
        if (current.dev !== info.dev || current.ino !== info.ino) throw new CapabilityError('FORBIDDEN', 'File identity changed');
        if (!info.isFile() || info.nlink !== 1 || info.size > LIMIT) throw new CapabilityError('FORBIDDEN', 'Select a regular file up to 512 KiB without hard links');
        context.assertCurrent?.();
        const buffer = Buffer.alloc(LIMIT + 1); let size = 0;
        while (size <= LIMIT) { context.signal?.throwIfAborted(); const read = await file.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
        if (size > LIMIT) throw new CapabilityError('INVALID_INPUT', 'File grew beyond the read limit');
        const finalPath = selectedFilePath(space.root, absolutePath), final = await stat(finalPath);
        if (finalPath !== path || final.dev !== info.dev || final.ino !== info.ino || (await file.stat()).nlink !== 1) throw new CapabilityError('FORBIDDEN', 'File identity changed');
        context.signal?.throwIfAborted(); context.assertCurrent?.(); const bytes = buffer.subarray(0, size);
        return { id, name: resource.name, mimeType: resource.mimeType ?? 'application/octet-stream', size,
          sha256: createHash('sha256').update(bytes).digest('hex'), encoding, content: encoding === 'utf8' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : bytes.toString('base64') };
      } finally { await file.close(); }
    },
  }));
  dispatcher.register(defineAtomicCapability({ id: 'xopc.files.propose_export', majorVersion: 1, effect: 'local-write', surfaces: ['extension'], scopes: ['workspace.write'],
    description: 'Stage a bounded file for host-reviewed browser download. Does not write or overwrite a host path.', input: exportInput, output: resultSchema,
    execute(input, context) {
      if (input.name.startsWith('.') || /[\u202a-\u202e\u2066-\u2069]/.test(input.name)) throw new CapabilityError('INVALID_INPUT', 'Use a visible export filename');
      if (input.encoding === 'base64' && Buffer.from(input.content, 'base64').toString('base64') !== input.content) throw new CapabilityError('INVALID_INPUT', 'Invalid base64 file content');
      if (Buffer.byteLength(input.content, input.encoding === 'base64' ? 'base64' : 'utf8') > LIMIT) throw new CapabilityError('INVALID_INPUT', 'Export exceeds 512 KiB'); return requestRecord(context, 'export', input);
    },
  }));
  dispatcher.register(defineReadCapability({ id: 'xopc.connectors.describe', majorVersion: 1, effect: 'read', surfaces: ['extension'], scopes: ['gateway.admin'],
    description: 'Describe an approved connector action for one exact account and connection epoch.', input: connectorInput.omit({ arguments: true }),
    output: z.object({ toolRef: z.string(), accountId: z.string(), revision: z.string(), scope: z.enum(['read', 'write']), inputSchema: z.json() }),
    async execute(input, context) { return connectorLease(context, async lease => { const current = await connectorAccess(deps, { ...input, arguments: {} }, lease);
      return { ...input, revision: current.descriptor.revision, scope: current.scope, inputSchema: z.json().parse(current.descriptor.inputSchema) }; }); },
  }));
  dispatcher.register(defineReadCapability({ id: 'xopc.connectors.read', majorVersion: 1, effect: 'read', surfaces: ['extension'], scopes: ['gateway.admin'],
    description: 'Execute a host-curated read using an individually approved account and action.', input: connectorInput, output: z.json(),
    async execute(input, context) { return connectorLease(context, async context => { const tool = await connectorAccess(deps, input, context, 'read');
      new DurableState<{ start: number; count: number }>('local-app-connector-read-budget', context.localApp!.extensionId).update('minute', previous => {
        const budget = previous && Date.now() - previous.start < 60000 ? previous : { start: Date.now(), count: 0 };
        if (budget.count >= 60) throw new CapabilityError('UNAVAILABLE', 'Connector read budget exhausted');
        return { value: { ...budget, count: budget.count + 1 }, result: undefined };
      });
      const output = await tool.service.execute({ toolRef: input.toolRef, revision: tool.descriptor.revision, arguments: connectorArguments(input),
        personalReadOnly: true, context: { toolCallId: randomUUID(), signal: context.signal, authorize: () => { context.assertCurrent?.(); connectionCurrent(tool.binding.accountId, tool.binding.connectionId, tool.binding.connectorId); } } });
      context.assertCurrent?.();
      const pending = JSON.parse(output.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as { status?: string };
      if (pending.status === 'confirmation_required') return { status: 'review_required', requestId: requestRecord(context, 'connector', input, 'xopc.connectors.read').id };
      return boundedResult(output); }); },
  }));
  dispatcher.register(defineAtomicCapability({ id: 'xopc.connectors.propose_write', majorVersion: 1, effect: 'local-write', surfaces: ['extension'], scopes: ['gateway.admin'],
    description: 'Store an exact connector write for separate host review; sends nothing until approved.', input: connectorInput, output: resultSchema,
    execute(input, context) { return requestRecord(context, 'connector', input); },
  }));
  dispatcher.register(defineReadCapability({ id: 'xopc.apps.get_request', majorVersion: 1, effect: 'read', surfaces: ['extension'], scopes: ['workspace.read'],
    description: 'Recover the review result of this app’s connector write or file export request.', input: z.strictObject({ id: z.uuid() }), output: resultSchema,
    async execute({ id }, context) {
      if (!context.localApp) throw new CapabilityError('FORBIDDEN', 'App identity is required');
      const record = readAppResourceRequest(context.localApp.extensionId, id);
      if (record.kind === 'connector' && record.status === 'approved' && record.result !== undefined) {
        if (!context.scopes.includes('gateway.admin') || record.grantRevision !== context.localApp.grantRevision
          || record.manifestDigest !== context.localApp.manifestDigest) throw new CapabilityError('FORBIDDEN', 'Original connector result authority is required');
        const tool = await connectorLease(context, lease => connectorAccess(deps, record.input as z.infer<typeof connectorInput>, lease));
        if (hash(tool.binding) !== hash(record.binding)) throw new CapabilityError('FORBIDDEN', 'Connector result authority changed');
      }
      return record;
    },
  }));
}
