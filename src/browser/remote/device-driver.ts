import { randomUUID } from 'node:crypto';

import type { BrowserControlResult, BrowserNavigateInput, BrowserObservation, BrowserObserveInput, BrowserTabsInput, BrowserTarget } from '@xopcai/browser-control-contract';
import { REMOTE_BROWSER_CONTROL_TOOL, type RemoteBrowserCommand, type RemoteBrowserInput } from '@xopcai/browser-control-contract/remote';
import { z } from 'zod';

import { hasReviewedDesktopExecutionStop } from '../../storage/sqlite/desktop-operation-repository.js';
import { hasVerifiedDesktopExecutionStop } from '../../storage/sqlite/desktop-execution-stop-repository.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import type { BrowserDriver, BrowserPrimitiveInput } from '../drivers/browser-driver.js';
import { invokeRemoteBrowserCommand } from './endpoint-transport.js';

const id = z.string().min(1).max(200);
const node = z.object({ ref: id, role: z.string().max(100), name: z.string().max(12000), value: z.string().max(12000).optional(),
  description: z.string().max(12000).optional(), href: z.string().max(4096).optional(), states: z.array(z.string().max(100)).max(32), parent: id.optional(),
  bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative().finite(), height: z.number().nonnegative().finite() }).strict().optional(),
}).strict();
const observation = z.object({ sessionId: id, tabId: id, revision: z.number().int().positive(), documentId: id,
  url: z.string().max(4096), title: z.string().max(4096), focused: id.optional(), nodes: z.array(node).max(500),
  changes: z.object({ added: z.array(node).max(500), changed: z.array(node).max(500), removed: z.array(id).max(500) }).strict(),
  truncation: z.object({ omittedNodeCount: z.number().int().nonnegative(), visualOmitted: z.boolean(), changesOmitted: z.boolean() }).strict().optional(),
}).strict();
const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), receipt: z.object({ action: z.enum(['observe', 'navigate', 'resolve', 'click', 'fill', 'select', 'check', 'press', 'scroll', 'wait', 'tabs', 'close']),
    risk: z.enum(['read', 'draft', 'external_effect', 'destructive', 'sensitive']), durationMs: z.number().finite().nonnegative(), verified: z.boolean(),
    businessOutcome: z.enum(['completed', 'verified', 'unknown']).optional(), outputs: z.record(z.string().max(100), z.string().max(4096)).optional(),
    observation: observation.optional(), tabs: z.array(z.object({ id, url: z.string().max(4096), title: z.string().max(4096), active: z.boolean() }).strict()).max(4).optional(),
  }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: z.enum(['ABORTED', 'BLOCKED_URL', 'DRIVER_UNAVAILABLE', 'EXPECTATION_FAILED', 'INVALID_INPUT', 'SESSION_NOT_FOUND',
    'STALE_OBSERVATION', 'TARGET_NOT_FOUND', 'TIMEOUT', 'UNSUPPORTED_PAGE']), message: z.string().max(4000), observation: observation.optional() }).strict() }).strict(),
]);
const replySchema = z.object({ version: z.literal(1), dispatch: z.enum(['completed', 'notStarted']), result: resultSchema }).strict();

/** One conversation and exact device connection. Default/server Browser drivers are never instantiated by this adapter. */
export class RemoteDeviceBrowserDriver implements BrowserDriver {
  readonly kind = 'desktop' as const;
  private session?: string;
  private used = false;
  private bound?: { connectionId: string; deviceId: string; gatewayId: string; grantId: string; revision: number; instanceId: string; toolRevision: string };
  constructor(private readonly endpoints: EndpointToolRuntime, private readonly endpointId: string, private readonly owner: string) {}
  async connect(): Promise<void> { this.current(); }
  private current() {
    const endpoint = this.endpoints.registry.get(this.endpointId), authority = endpoint?.executionAuthority;
    const tool = this.endpoints.registry.getTool(this.endpointId, REMOTE_BROWSER_CONTROL_TOOL);
    if (!endpoint || endpoint.kind !== 'desktop' || !authority || !tool || endpoint.availability !== 'foreground'
      || endpoint.principalId !== authority.deviceId || authority.expiresAt <= Date.now()) throw new Error('BROWSER_REMOTE_AUTHORITY_INVALID');
    const next = { connectionId: endpoint.connectionId, deviceId: authority.deviceId, gatewayId: authority.gatewayId, grantId: authority.grantId,
      revision: authority.authorizationRevision, instanceId: authority.connectionInstanceId, toolRevision: tool.revision };
    if (this.bound && JSON.stringify(this.bound) !== JSON.stringify(next)) throw new Error('BROWSER_REMOTE_CONNECTION_CHANGED');
    this.bound ??= next;
  }
  async createSession(sessionId: string): Promise<void> {
    this.current(); id.parse(sessionId);
    if (this.session && this.session !== sessionId) throw new Error('BROWSER_REMOTE_SESSION_MISMATCH');
    this.session = sessionId;
  }
  async disconnect(): Promise<void> { if (this.session) await this.closeSession(this.session); }
  verifiedStopped(): boolean {
    const bound = this.bound; if (!bound) return false;
    const scope = { gatewayId: bound.gatewayId, deviceId: bound.deviceId, authorizationRevision: bound.revision,
      tool: REMOTE_BROWSER_CONTROL_TOOL as typeof REMOTE_BROWSER_CONTROL_TOOL, toolRevision: bound.toolRevision };
    try { return hasVerifiedDesktopExecutionStop(scope) || hasReviewedDesktopExecutionStop(scope); } catch { return false; }
  }
  async closeSession(sessionId: string, target?: BrowserTarget): Promise<void> {
    if (this.session !== sessionId) throw new Error('BROWSER_REMOTE_SESSION_MISMATCH');
    this.target(target);
    if (this.used && !this.verifiedStopped()) {
      try {
        const result = await this.send(sessionId, { action: 'close' }, target);
        if ('error' in result || !result.receipt.verified) throw new Error('BROWSER_REMOTE_RELEASE_UNCONFIRMED');
      } catch (error) {
        if (!this.verifiedStopped()) throw error;
      }
    }
    this.session = undefined; this.used = false;
  }
  navigate(sessionId: string, input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    const { target, sessionId: _session, ...value } = input; return this.send(sessionId, value, target, signal);
  }
  async observe(sessionId: string, input: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation> {
    const { target, sessionId: _session, ...value } = input, result = await this.send(sessionId, value, target, signal);
    if ('error' in result) throw new Error(result.error.message);
    if (!result.receipt.observation) throw new Error('BROWSER_REMOTE_OBSERVATION_MISSING');
    return result.receipt.observation;
  }
  perform(sessionId: string, input: BrowserPrimitiveInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    if (input.action === 'upload') return Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message: 'Remote Browser does not accept server paths. Use an explicitly authorized file transfer.' } });
    const { target, sessionId: _session, ...value } = input; return this.send(sessionId, value, target, signal);
  }
  tabs(sessionId: string, input: BrowserTabsInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    const { target, sessionId: _session, ...value } = input; return this.send(sessionId, value, target, signal);
  }
  private target(target: BrowserTarget | undefined): void {
    if (target && (target.kind !== 'endpoint' || target.endpointId !== this.endpointId)) throw new Error('BROWSER_REMOTE_TARGET_MISMATCH');
  }
  private async send(sessionId: string, input: RemoteBrowserInput, target?: BrowserTarget, signal?: AbortSignal): Promise<BrowserControlResult> {
    this.current(); this.target(target);
    if (this.session !== sessionId) throw new Error('BROWSER_REMOTE_SESSION_MISMATCH');
    const command: RemoteBrowserCommand = { version: 1, owner: this.owner, sessionId, actionId: randomUUID(), input };
    this.used = true;
    const reply = await invokeRemoteBrowserCommand(this.endpoints, this.endpointId, command, signal);
    const json = reply.content.filter(item => item.type === 'json'), files = reply.content.filter(item => item.type === 'file');
    let bytes: Uint8Array | undefined;
    try {
      if (files.length === 1 && reply.invocationId) bytes = this.endpoints.uploads.takeComputerFrame(files[0].fileId, reply.invocationId);
      if (json.length !== 1 || files.length > 1) throw new Error('BROWSER_REMOTE_RESULT_INVALID');
      const result: BrowserControlResult = replySchema.parse(json[0].value).result;
      const state = 'error' in result ? result.error.observation : result.receipt.observation;
      this.current(); signal?.throwIfAborted();
      if (state && state.sessionId !== sessionId || !('error' in result) && result.receipt.action !== input.action) throw new Error('BROWSER_REMOTE_RESULT_MISMATCH');
      if (files.length && (!bytes || !state || !['image/png', 'image/jpeg'].includes(files[0].mimeType))) throw new Error('BROWSER_REMOTE_FRAME_MISSING');
      if (input.action === 'observe' && input.visual === 'always' && !('error' in result) && !bytes) throw new Error('BROWSER_REMOTE_FRAME_MISSING');
      if (bytes && state) {
        const copy = Buffer.from(bytes);
        try { state.visual = { mimeType: files[0].mimeType as 'image/png' | 'image/jpeg', data: copy.toString('base64') }; }
        finally { copy.fill(0); }
      }
      return result;
    } finally { bytes?.fill(0); }
  }
}
