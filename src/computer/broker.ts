import { createHash, randomUUID } from 'node:crypto';
import {
  ActionEnvelopeSchema, ComputerCommandSchema,
  type ComputerAction, type ComputerCommand, type ComputerModelBinding,
  type ComputerObservation, type ComputerReceipt, type ComputerTarget,
} from '@xopcai/computer-control-contract';
import { ComputerConfigSchema, type ComputerConfig } from './config.js';

export interface DriverObservation {
  target: ComputerTarget;
  summary: string;
  focusedEditableRef?: string;
  stateDigest: string;
  image: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  imageWidth: number;
  imageHeight: number;
}
export interface ComputerDriver {
  validateAction?(action: ComputerAction): void;
  resolveTarget(appId: string, signal: AbortSignal): Promise<ComputerTarget>;
  observe(target: ComputerTarget, signal: AbortSignal): Promise<DriverObservation>;
  perform(target: ComputerTarget, action: ComputerAction, signal: AbortSignal): Promise<void>;
  /** Must finish only after no further input can be dispatched. */
  stop(): Promise<void>;
}
export type ComputerApproval =
  | { kind: 'session'; id: string; appId: string; model: ComputerModelBinding }
  | { kind: 'action'; id: string; target: ComputerTarget; action: ComputerAction };
export interface ComputerBrokerHost {
  requestApproval(request: ComputerApproval, signal: AbortSignal): Promise<boolean>;
  isVisible(): boolean;
  hasFullControl?(): boolean;
  onStateChange?(): void;
}
type Status = 'pending_authorization' | 'ready' | 'running' | 'pending_action' | 'paused' | 'stopped';
interface Session {
  id: string; owner: string; appId: string; model: ComputerModelBinding;
  grantId: string; generation: number; status: Status; createdAt: number; touchedAt: number;
  controller: AbortController; target?: ComputerTarget; observation?: ComputerObservation;
  receipts: Map<string, { digest: string; receipt: ComputerReceipt }>;
  pending?: { envelope: import('@xopcai/computer-control-contract').ActionEnvelope; digest: string; approved?: boolean };
  actions: number;
  errorCode?: string;
}
export interface BrokerResult {
  status: Status;
  sessionId: string;
  brokerEpoch: string;
  generation: number;
  grantId?: string;
  observation?: ComputerObservation;
  receipt?: ComputerReceipt;
  errorCode?: string;
  frame?: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' };
}

/** Main-process-only authority. Never expose this object or its approval hook to a renderer. */
export class ComputerBroker {
  readonly epoch = randomUUID();
  private session?: Session;
  private busy = false;
  private stopping?: Promise<void>;
  private readonly config: ComputerConfig;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly driver: ComputerDriver, private readonly host: ComputerBrokerHost, config: Partial<ComputerConfig> = {}, private readonly now = Date.now) {
    this.config = ComputerConfigSchema.parse(config);
    this.timer = setInterval(() => {
      const s = this.session;
      if (s && s.status !== 'stopped' && (this.expired(s) || !this.host.isVisible())) void this.stop().catch(() => {});
    }, 1000);
    this.timer.unref?.();
  }
  private expired(s: Session): boolean {
    return this.now() - s.createdAt >= this.config.maxSessionDurationMs || this.now() - s.touchedAt >= this.config.idleGrantTtlMs;
  }
  private result(s: Session): BrokerResult {
    return { sessionId: s.id, brokerEpoch: this.epoch, generation: s.generation, status: s.status,
      ...(s.errorCode ? { errorCode: s.errorCode } : {}),
      ...(s.status === 'ready' ? { grantId: s.grantId } : {}) };
  }
  private active(s: Session): void {
    if (this.session !== s || s.controller.signal.aborted || this.expired(s) || !this.host.isVisible()) throw new Error('COMPUTER_GRANT_REVOKED');
  }
  async command(raw: ComputerCommand): Promise<BrokerResult> {
    const command = ComputerCommandSchema.parse(raw);
    if (command.op === 'open') return this.open(command);
    const s = this.session;
    if (!s || s.id !== command.sessionId || s.owner !== command.owner) throw new Error('COMPUTER_SESSION_NOT_FOUND');
    if (command.op === 'release') { await this.stop(); return this.result(s); }
    if (command.op === 'status') return this.result(s);
    this.active(s);
    if (this.busy || (s.status !== 'ready' && s.status !== 'pending_action')) throw new Error('COMPUTER_NOT_READY');
    this.busy = true;
    try {
      if (command.op === 'observe') {
        if (s.pending) throw new Error('COMPUTER_ACTION_PENDING');
        return await this.observe(s);
      }
      return await this.act(s, command.envelope);
    } finally { this.busy = false; this.host.onStateChange?.(); }
  }
  private async open(command: Extract<ComputerCommand, { op: 'open' }>): Promise<BrokerResult> {
    if (!this.config.enabled) throw new Error('COMPUTER_DISABLED');
    if (!this.host.isVisible()) throw new Error('COMPUTER_LOCAL_UI_REQUIRED');
    if (this.stopping) throw new Error('COMPUTER_STOPPING');
    if (this.session && this.session.status !== 'stopped') {
      const s = this.session;
      if (s.id !== command.sessionId || s.owner !== command.owner || s.appId !== command.appId || JSON.stringify(s.model) !== JSON.stringify(command.model)) throw new Error('COMPUTER_DEVICE_BUSY');
      return this.result(s);
    }
    const s: Session = { id: command.sessionId, owner: command.owner, appId: command.appId, model: command.model,
      grantId: randomUUID(), generation: 0, status: 'pending_authorization', createdAt: this.now(), touchedAt: this.now(),
      controller: new AbortController(), receipts: new Map(), actions: 0 };
    this.session = s;
    // Consent precedes target discovery and screenshot capture; RPC itself stays short.
    const fullControl = this.host.hasFullControl?.() === true;
    const authorization = (fullControl ? Promise.resolve(true) : this.host.requestApproval({ kind: 'session', id: s.id, appId: s.appId, model: s.model }, s.controller.signal)).then(async (approved) => {
      this.active(s);
      if (!approved) { await this.stop(); return; }
      s.target = await this.driver.resolveTarget(s.appId, s.controller.signal);
      this.active(s);
      if (s.target.appId !== s.appId) throw new Error('COMPUTER_TARGET_MISMATCH');
      s.status = 'ready'; s.touchedAt = this.now();
    }).catch((error) => {
      if (this.session !== s) return;
      s.errorCode = error instanceof Error && /^COMPUTER_[A-Z_]+$/.test(error.message) ? error.message : 'COMPUTER_NATIVE_SETUP_FAILED';
      return this.stop().catch(() => {});
    }).finally(() => this.host.onStateChange?.());
    // Full control must return ready, not suspend the agent for a nonexistent dialog.
    if (fullControl) await authorization;
    return this.result(s);
  }
  private async observe(s: Session): Promise<BrokerResult> {
    const frame = await this.driver.observe(s.target!, s.controller.signal);
    try {
    this.active(s);
    if (frame.target.appId !== s.appId || frame.target.processIdentity !== s.target!.processIdentity || frame.target.windowId !== s.target!.windowId) throw new Error('COMPUTER_TARGET_CHANGED');
    if (frame.image.byteLength > 5 * 1024 * 1024 || frame.imageWidth * frame.imageHeight > 16_000_000) throw new Error('COMPUTER_FRAME_LIMIT');
    s.target = frame.target;
    s.observation = { id: randomUUID(), sessionId: s.id, brokerEpoch: this.epoch, generation: s.generation,
      target: frame.target, capturedAt: this.now(), imageWidth: frame.imageWidth, imageHeight: frame.imageHeight,
      summary: frame.summary.slice(0, 12_000), focusedEditableRef: frame.focusedEditableRef, stateDigest: frame.stateDigest };
    s.touchedAt = this.now();
    return { ...this.result(s), observation: s.observation, frame: { bytes: frame.image, mimeType: frame.mimeType } };
    } catch (error) {
      frame.image.fill(0);
      throw error;
    }
  }
  private async act(s: Session, raw: import('@xopcai/computer-control-contract').ActionEnvelope): Promise<BrokerResult> {
    const e = ActionEnvelopeSchema.parse(raw);
    if (e.sessionId !== s.id || e.brokerEpoch !== this.epoch || e.generation !== s.generation || e.grantId !== s.grantId || e.deadlineAt <= this.now()) throw new Error('COMPUTER_STALE_ACTION');
    const digest = createHash('sha256').update(JSON.stringify(e)).digest('hex');
    const previous = s.receipts.get(e.actionId);
    if (previous) {
      if (previous.digest !== digest) throw new Error('COMPUTER_ACTION_ID_REUSED');
      return { ...this.result(s), receipt: previous.receipt };
    }
    const observed = s.observation;
    if (!observed || e.observationId !== observed.id || this.now() - observed.capturedAt > 120_000) throw new Error('COMPUTER_STALE_OBSERVATION');
    if (s.actions >= this.config.maxActionsPerSession) throw new Error('COMPUTER_ACTION_BUDGET');
    if ('point' in e.action && e.action.point && (e.action.point.x >= observed.imageWidth || e.action.point.y >= observed.imageHeight)) throw new Error('COMPUTER_COORDINATE_OUTSIDE_WINDOW');
    if (e.action.kind === 'typeText' && !e.action.point && !observed.focusedEditableRef) throw new Error('COMPUTER_EDITABLE_TARGET_REQUIRED');
    this.driver.validateAction?.(e.action);
    // Only the local host policy can waive approval; model-supplied risk labels cannot.
    if (e.action.kind !== 'wait' && !this.host.hasFullControl?.()) {
      if (!s.pending) {
        s.pending = { envelope: e, digest }; s.status = 'pending_action';
        void this.host.requestApproval({ kind: 'action', id: e.actionId, target: observed.target, action: e.action }, s.controller.signal).then((approved) => {
          this.active(s);
          if (s.pending?.digest === digest) s.pending.approved = approved;
        }).catch(() => {}).finally(() => this.host.onStateChange?.());
        return this.result(s);
      }
      if (s.pending.digest !== digest) throw new Error('COMPUTER_DIFFERENT_ACTION_PENDING');
      if (s.pending.approved === undefined) return this.result(s);
      if (!s.pending.approved) { await this.stop(); return this.result(s); }
    }
    const current = await this.driver.observe(s.target!, s.controller.signal);
    try {
      this.active(s);
      if (JSON.stringify(current.target) !== JSON.stringify(observed.target) || current.stateDigest !== observed.stateDigest || e.deadlineAt <= this.now()) {
        s.pending = undefined; s.observation = undefined; s.status = 'ready';
        throw new Error('COMPUTER_APPROVAL_TARGET_CHANGED');
      }
      this.driver.validateAction?.(e.action);
    } finally { current.image.fill(0); }
    const receipt: ComputerReceipt = { actionId: e.actionId, dispatch: 'started', outcome: 'unknown', verification: 'none' };
    s.receipts.set(e.actionId, { digest, receipt }); s.actions++; s.pending = undefined; s.status = 'running';
    try {
      await this.driver.perform(s.target!, e.action, s.controller.signal);
      this.active(s);
      receipt.dispatch = 'completed';
      s.status = 'ready';
      const after = await this.observe(s);
      // A changed screenshot is observation evidence, not proof of business success.
      receipt.verification = after.observation ? 'visual' : 'none';
      return { ...after, receipt };
    } catch {
      receipt.dispatch = 'unknown';
      await this.stop();
      return { ...this.result(s), receipt };
    }
  }
  stop(): Promise<void> {
    const s = this.session;
    if (s && s.status !== 'stopped') {
      s.generation++; s.status = 'stopped'; s.pending = undefined; s.observation = undefined;
      s.controller.abort();
    }
    if (!this.stopping) this.stopping = this.driver.stop().finally(() => { this.stopping = undefined; this.host.onStateChange?.(); });
    return this.stopping;
  }
  snapshot(): { status: Status | 'idle'; errorCode?: string; appId?: string } {
    return this.session ? { status: this.session.status, errorCode: this.session.errorCode, appId: this.session.appId } : { status: 'idle' };
  }
  async dispose(): Promise<void> { clearInterval(this.timer); await this.stop(); }
}
