import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LocalAppPreviewCreateSchema, LocalAppResourceScopesSchema, type CapabilityCall,
  type LocalAppPreviewCreate, type LocalAppPreviewSession, type ExtensionCapabilityBinding } from '@xopcai/gateway-contract';
import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import { localAppCapabilities } from './capabilities/runtime.js';
import { readPreviewFixtures } from './preview-fixtures.js';
import { createLogger } from '../utils/logger.js';
import { LOCAL_APP_RUNTIME_BRIDGE_HASH } from './preview-runtime-bridge.js';
import { forkWorker } from '../process/fork-worker.js';

const log = createLogger('LocalApps:Preview');

export interface PreviewSource {
  appId: string;
  extensionId: string;
  sourceHash: string;
  previewUrl: string;
  root: string;
  permissions: string[];
  bindings: ExtensionCapabilityBinding[];
  scenarioIds: string[];
}
interface Lease {
  session: LocalAppPreviewSession;
  owner: string;
  lastUsedAt: number;
  scopes: ReturnType<typeof LocalAppResourceScopesSchema.parse>;
  storage: Map<string, unknown>;
  worker?: ChildProcess;
  directory?: string;
  queue: Promise<unknown>;
  timer: ReturnType<typeof setTimeout>;
}
const TTL = 15 * 60_000;

/** Preview leases are separate from installed releases and never grant production writes. */
export class LocalAppPreviewSessions {
  private readonly leases = new Map<string, Lease>();
  private readonly closingWorkers = new Set<ChildProcess>();
  constructor(private readonly stateRoot: () => string,
    private readonly source: (appId: string, sourceHash: string) => PreviewSource,
    private readonly assertSource: (appId: string, sourceHash: string) => void) {}

  async create(appId: string, value: LocalAppPreviewCreate, caller: CapabilityContext): Promise<LocalAppPreviewSession> {
    const input = LocalAppPreviewCreateSchema.parse(value);
    if (caller.signal?.aborted) throw new CapabilityError('CANCELLED', 'Preview request cancelled');
    this.assertSource(appId, input.sourceHash);
    for (const lease of [...this.leases.values()]) {
      if (lease.session.appId === appId && lease.session.sourceHash !== input.sourceHash) this.revoke(lease.session.id);
    }
    for (const lease of this.leases.values()) if (lease.session.expiresAt <= Date.now()) this.revoke(lease.session.id);
    // Reclaim only this caller's idle workers; never interrupt another caller or a recent operation.
    if (input.mode !== 'readonly' && [...this.leases.values()].filter(lease => lease.worker).length + this.closingWorkers.size >= 4) {
      const idle = [...this.leases.values()].filter(lease => lease.worker && lease.owner === caller.principalId
        && Date.now() - lease.lastUsedAt >= 30_000).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (idle) this.revoke(idle.session.id);
    }
    if (this.leases.size >= 12 || [...this.leases.values()].filter(lease => lease.owner === caller.principalId).length >= 6) {
      throw new CapabilityError('UNAVAILABLE', 'Close another preview before opening a new one');
    }
    const source = this.source(appId, input.sourceHash);
    if (input.scenarioId && (input.mode !== 'isolated' || !source.scenarioIds.includes(input.scenarioId))) {
      throw new CapabilityError('INVALID_INPUT', 'Unknown isolated acceptance scenario');
    }
    const scopes = LocalAppResourceScopesSchema.parse(input.resourceScopes ?? {});
    if (input.mode === 'readonly' && (scopes.notesWrite.mode !== 'none' || scopes.agentDelegate)) throw new CapabilityError('FORBIDDEN', 'Real preview is read-only');
    if (input.mode !== 'readonly' && input.resourceScopes) throw new CapabilityError('INVALID_INPUT', 'Synthetic previews do not accept production resource grants');
    const bindings = source.bindings.filter(binding => binding.id !== 'xopc.agent.delegate' && (input.mode !== 'readonly' || /\.(get|list)$/.test(binding.id)));
    const session: LocalAppPreviewSession = { id: randomUUID(), appId, extensionId: source.extensionId, sourceHash: source.sourceHash,
      mode: input.mode, expiresAt: Date.now() + TTL, previewUrl: `${source.previewUrl}?xopcRuntime=${encodeURIComponent(LOCAL_APP_RUNTIME_BRIDGE_HASH)}`,
      bindings, permissions: source.permissions.filter(permission => ['theme', 'storage', 'notification'].includes(permission))
        .concat(bindings.map(binding => `capability:${binding.id}`)) };
    const timer = setTimeout(() => this.revoke(session.id), TTL); timer.unref?.();
    const lease: Lease = { session, scopes, owner: caller.principalId, lastUsedAt: Date.now(), storage: new Map(), timer, queue: Promise.resolve() };
    this.leases.set(session.id, lease);
    try {
      if (input.mode !== 'readonly') {
        const deadline = Date.now() + 2000;
        while ([...this.leases.values()].filter(item => item.worker).length + this.closingWorkers.size >= 4
          && this.closingWorkers.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        this.current(session.id, caller);
        if ([...this.leases.values()].filter(item => item.worker).length + this.closingWorkers.size >= 4) throw new CapabilityError('UNAVAILABLE', 'Too many isolated preview workers');
        const root = join(this.stateRoot(), 'local-apps', 'preview-runs'); mkdirSync(root, { recursive: true, mode: 0o700 });
        lease.directory = mkdtempSync(join(root, 'run-'));
        const built = new URL('./preview-worker.js', import.meta.url);
        const compiled = existsSync(built);
        lease.worker = forkWorker(fileURLToPath(compiled ? built : new URL('./preview-worker.ts', import.meta.url)), {
          cwd: lease.directory, execArgv: ['--max-old-space-size=384', ...(compiled ? [] : ['--import', import.meta.resolve('tsx')])],
          env: { PATH: process.env.PATH, XOPC_LOCAL_APP_PREVIEW_WORKER: '1', XOPC_STATE_DIR: lease.directory,
            XOPC_WORKSPACE: lease.directory, XOPC_SQLITE_ASSET_ROOT: process.env.XOPC_SQLITE_ASSET_ROOT,
            XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_CONSOLE: 'false', ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json',
        });
        let workerStderr = '';
        lease.worker.stderr?.on('data', (chunk: Buffer) => { workerStderr = (workerStderr + chunk.toString()).slice(-4000); });
        lease.worker.unref(); lease.worker.channel?.unref();
        const directory = lease.directory;
        lease.worker.once('exit', (code, signal) => {
          if (this.leases.has(session.id)) {
            log.error({ sessionId: session.id, code, signal, workerStderr }, 'Isolated preview worker exited unexpectedly');
            if (process.env.VITEST) process.stderr.write(`Preview worker exit: ${JSON.stringify({ code, signal, workerStderr })}\n`);
          }
          this.revoke(session.id); rmSync(directory, { recursive: true, force: true });
        });
        await this.rpc(lease, { type: 'init', fixtures: readPreviewFixtures(source.root), bindings });
      }
      this.current(session.id, caller);
      return structuredClone(session);
    } catch (error) { this.revoke(session.id); throw error; }
  }

  private current(id: string, caller: CapabilityContext): Lease {
    const lease = this.leases.get(id);
    if (!lease || lease.owner !== caller.principalId || lease.session.expiresAt <= Date.now()) {
      throw new CapabilityError('FORBIDDEN', 'Preview authorization expired or was revoked');
    }
    if (caller.signal?.aborted) throw new CapabilityError('CANCELLED', 'Preview request cancelled');
    try { this.assertSource(lease.session.appId, lease.session.sourceHash); }
    catch (error) { this.revoke(id); throw error; }
    lease.lastUsedAt = Date.now();
    return lease;
  }

  describe(id: string, caller: CapabilityContext, dispatcher: CapabilityDispatcher) {
    const lease = this.current(id, caller);
    const context = { ...caller, surface: 'extension' as const,
      allowedCapabilities: lease.session.bindings.map(binding => binding.id).filter(capability => !caller.allowedCapabilities || caller.allowedCapabilities.includes(capability)) };
    return { session: structuredClone(lease.session), capabilities: dispatcher.list(context).filter(descriptor => lease.session.bindings.some(binding =>
      binding.id === descriptor.id && binding.majorVersion === descriptor.majorVersion && binding.descriptorDigest === descriptor.descriptorDigest)) };
  }

  async call(sessionId: string, id: string, call: CapabilityCall, caller: CapabilityContext, dispatcher: CapabilityDispatcher) {
    const lease = this.current(sessionId, caller);
    const binding = lease.session.bindings.find(item => item.id === id);
    if (!binding) throw new CapabilityError('FORBIDDEN', 'Capability is not available in this preview');
    if (binding.majorVersion !== call.majorVersion || binding.descriptorDigest !== call.descriptorDigest) throw new CapabilityError('CONTRACT_CHANGED', 'Preview contract changed');
    if (lease.session.mode === 'readonly') {
      const adapter = { getCapabilityAccess: () => {
        this.current(sessionId, caller);
        return { releaseId: `preview:${lease.session.sourceHash}`, grantRevision: sessionId, bindings: lease.session.bindings, resourceScopes: lease.scopes };
      } };
      return localAppCapabilities(adapter, dispatcher, lease.session.extensionId, lease.session.sourceHash, caller, sessionId).call(id, call);
    }
    const input = await dispatcher.validateInput(id, call.input, { ...caller, surface: 'extension',
      allowedCapabilities: lease.session.bindings.map(item => item.id).filter(item => !caller.allowedCapabilities || caller.allowedCapabilities.includes(item)),
      assertCurrent: () => { caller.assertCurrent?.(); this.current(sessionId, caller); } });
    const operation = lease.queue.then(async () => {
      this.current(sessionId, caller);
      const data = await this.rpc(lease, { type: 'call', id, call: {
        majorVersion: call.majorVersion, descriptorDigest: call.descriptorDigest, idempotencyKey: call.idempotencyKey, input,
      } });
      this.current(sessionId, caller);
      return { status: 'succeeded' as const, releaseId: `preview:${lease.session.sourceHash}`, data };
    });
    lease.queue = operation.catch(() => {});
    return operation;
  }

  storage(id: string, caller: CapabilityContext, method: string, key = '', value?: unknown): unknown {
    const lease = this.current(id, caller);
    if (!lease.session.permissions.includes('storage')) throw new CapabilityError('FORBIDDEN', 'Preview storage is not declared');
    if (key.length > 512 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new CapabilityError('INVALID_INPUT', 'Invalid storage key');
    if (method === 'storage.keys') return [...lease.storage.keys()];
    if (method === 'storage.get') return lease.storage.get(key);
    if (method === 'storage.remove') { lease.storage.delete(key); return null; }
    if (method === 'storage.set') {
      const candidate = new Map(lease.storage); candidate.set(key, value);
      if (Buffer.byteLength(JSON.stringify([...candidate])) > 5_000_000) throw new CapabilityError('INVALID_INPUT', 'Preview storage quota exceeded');
      lease.storage = candidate; return null;
    }
    throw new CapabilityError('INVALID_INPUT', 'Unknown preview storage method');
  }

  remove(id: string, caller: CapabilityContext): void {
    const lease = this.leases.get(id);
    if (lease && lease.owner !== caller.principalId) throw new CapabilityError('FORBIDDEN', 'Preview belongs to another caller');
    this.revoke(id);
  }

  revokeApp(appId: string): void {
    for (const lease of this.leases.values()) if (lease.session.appId === appId) this.revoke(lease.session.id);
  }

  async close(): Promise<void> {
    const workers = new Set([...this.leases.values()].map(lease => lease.worker).filter((worker): worker is ChildProcess => Boolean(worker)));
    for (const worker of this.closingWorkers) workers.add(worker);
    const exits = [...workers].map(worker => {
      if (!worker.pid || worker.exitCode !== null || worker.signalCode !== null) return Promise.resolve();
      return new Promise<void>(resolve => worker.once('exit', () => resolve()));
    });
    for (const id of [...this.leases.keys()]) this.revoke(id);
    await Promise.all(exits);
  }

  private revoke(id: string): void {
    const lease = this.leases.get(id); if (!lease) return;
    this.leases.delete(id); clearTimeout(lease.timer); lease.storage.clear();
    if (lease.worker?.pid && lease.worker.exitCode === null && lease.worker.signalCode === null) {
      this.closingWorkers.add(lease.worker);
      lease.worker.kill('SIGTERM');
      const timer = setTimeout(() => lease.worker?.kill('SIGKILL'), 1000); timer.unref?.();
      lease.worker.once('exit', () => { clearTimeout(timer); this.closingWorkers.delete(lease.worker!); });
    } else if (lease.directory) rmSync(lease.directory, { recursive: true, force: true });
  }

  private rpc(lease: Lease, payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const worker = lease.worker!; const requestId = randomUUID();
      const cleanup = () => { clearTimeout(timer); worker.off('message', message); worker.off('exit', exit); worker.off('error', exit); };
      const exit = () => { cleanup(); reject(new CapabilityError('UNAVAILABLE', 'Isolated preview worker stopped')); };
      const message = (result: { requestId?: string; data?: unknown; error?: { code: string; message: string; diagnostic?: string } }) => {
        if (result.requestId !== requestId) return;
        cleanup();
        if (result.error) {
          if (result.error.diagnostic) log.error({ sessionId: lease.session.id, errorMessage: result.error.diagnostic }, 'Isolated preview worker failed');
          reject(new CapabilityError(result.error.code as CapabilityError['code'], result.error.message));
        }
        else resolve(result.data);
      };
      const timer = setTimeout(() => { cleanup(); this.revoke(lease.session.id); reject(new CapabilityError('UNAVAILABLE', 'Isolated preview timed out')); }, 10_000);
      worker.on('message', message); worker.once('exit', exit); worker.once('error', exit);
      worker.send({ ...payload, requestId }, error => { if (error) exit(); });
    });
  }
}
