import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ActionEnvelopeSchema, computerActionInputCount, computerActionInputs, ComputerCommandSchema, COMPUTER_FRAME_MAX_BYTES, COMPUTER_FRAME_MAX_PIXELS,
  type ComputerAction, type ComputerCommand, type ComputerModelBinding,
  type ComputerObservation, type ComputerReceipt, type ComputerTarget, type ComputerApp, type ComputerWindow, type ComputerInputTiming,
} from '@xopcai/computer-control-contract';
import { ComputerConfigSchema, type ComputerConfig } from './config.js';
import type { ComputerNativeTiming } from './diagnostics.js';
import { ComputerTargetError } from './errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ComputerBroker');

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
  getPreparationState?(): { startedAt: number } | undefined;
  discover(query: string, signal: AbortSignal): Promise<Array<{ appId: string; name: string; running: boolean }>>;
  validateAction?(action: ComputerAction): void;
  resolveTarget(appId: string, signal: AbortSignal, options: { prepare: boolean; windowRef?: string }): Promise<ComputerTarget>;
  observe(target: ComputerTarget, signal: AbortSignal): Promise<DriverObservation>;
  perform(target: ComputerTarget, action: ComputerAction, signal: AbortSignal,
    onProgress?: (index: number, dispatch: 'notStarted' | 'started' | 'completed' | 'unknown') => void): Promise<void>;
  getLastInputTiming?(): ComputerInputTiming | undefined;
  /** Must finish only after no further input can be dispatched. */
  stop(): Promise<void>;
}
export type ComputerApproval =
  | { kind: 'session'; id: string; appId: string; appName: string; mode: 'observe' | 'control'; prepare: boolean; model: ComputerModelBinding }
  | { kind: 'action'; id: string; target: ComputerTarget; action: ComputerAction };
export interface ComputerBrokerHost {
  /** Hosts exposing a separate approval UI may opt into the legacy held-action protocol. */
  deferApproval?: boolean;
  requestApproval(request: ComputerApproval, signal: AbortSignal): Promise<boolean>;
  isVisible(): boolean;
  onStateChange?(): void;
}
type Status = 'pending_authorization' | 'ready' | 'running' | 'pending_action' | 'paused' | 'stopped';
interface Session {
  id: string; owner: string; appId: string; model: ComputerModelBinding;
  appRef: string; mode: 'observe' | 'control'; prepare: boolean; windowRef?: string;
  grantId: string; generation: number; status: Status; createdAt: number; touchedAt: number;
  controller: AbortController; target?: ComputerTarget; observation?: ComputerObservation;
  receipts: Map<string, { digest: string; receipt: ComputerReceipt }>;
  preparation?: Promise<void>;
  pending?: { envelope: import('@xopcai/computer-control-contract').ActionEnvelope; digest: string; approved?: boolean; decision?: Promise<void> };
  actions: number;
  errorCode?: string;
  windows?: ComputerWindow[];
}
export interface BrokerResult {
  status: Status;
  sessionId: string;
  brokerEpoch: string;
  generation: number;
  grantId?: string;
  observation?: ComputerObservation;
  receipt?: ComputerReceipt;
  nativeMs?: ComputerNativeTiming;
  errorCode?: string;
  apps?: ComputerApp[];
  windows?: ComputerWindow[];
  frame?: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' };
}

/** Main-process-only authority. Never expose this object or its approval hook to a renderer. */
export class ComputerBroker {
  readonly epoch = randomUUID();
  private session?: Session;
  private busy = false;
  private stopping?: Promise<void>;
  private discovery?: { controller: AbortController; owner: string; id: string };
  private readonly apps = new Map<string, { owner: string; appId: string; name: string; expires: number }>();
  private readonly config: ComputerConfig;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly driver: ComputerDriver, private readonly host: ComputerBrokerHost, config: Partial<ComputerConfig> = {}, private readonly now = Date.now, private readonly durationNow = now === Date.now ? () => performance.now() : now) {
    this.config = ComputerConfigSchema.parse(config);
    this.timer = setInterval(() => {
      const s = this.session;
      if (s && s.status !== 'stopped' && (this.expired(s) || !this.host.isVisible())) void this.stop(!this.host.isVisible() ? 'COMPUTER_LOCAL_UI_REQUIRED' : undefined).catch(() => {});
    }, 1000);
    this.timer.unref?.();
  }
  private expired(s: Session): boolean {
    return this.now() - s.createdAt >= this.config.maxSessionDurationMs || this.now() - s.touchedAt >= this.config.idleGrantTtlMs;
  }
  private result(s: Session): BrokerResult {
    return { sessionId: s.id, brokerEpoch: this.epoch, generation: s.generation, status: s.status,
      ...(s.errorCode ? { errorCode: s.errorCode } : {}),
      ...(s.windows ? { windows: s.windows } : {}),
      ...(s.status === 'ready' ? { grantId: s.grantId } : {}) };
  }
  private active(s: Session): void {
    if (!this.host.isVisible()) { s.errorCode ??= 'COMPUTER_LOCAL_UI_REQUIRED'; throw new Error('COMPUTER_LOCAL_UI_REQUIRED'); }
    if (this.session !== s || s.controller.signal.aborted || this.expired(s)) throw new Error('COMPUTER_GRANT_REVOKED');
  }
  /** Settings-only app catalog. It never returns window contents or task-bound refs. */
  async listAppsForSettings(): Promise<Array<{ appId: string; name: string; running: boolean }>> {
    if (this.busy || this.discovery || this.stopping || (this.session && this.session.status !== 'stopped')) throw new Error('COMPUTER_BUSY');
    this.busy = true;
    try { return await this.driver.discover('', AbortSignal.timeout(15_000)); }
    finally { try { await this.driver.stop(); } finally { this.busy = false; } }
  }
  async command(raw: ComputerCommand): Promise<BrokerResult> {
    const command = ComputerCommandSchema.parse(raw);
    if (command.op === 'discover') return this.discover(command);
    if (command.op === 'open') return this.open(command);
    const s = this.session;
    if (!s || s.id !== command.sessionId || s.owner !== command.owner) throw new Error('COMPUTER_SESSION_NOT_FOUND');
    if (command.op === 'release') { await this.stop(); return this.result(s); }
    if (command.op === 'status') return this.result(s);
    if (command.op === 'settle') {
      const decision = s.status === 'pending_authorization' ? s.preparation : s.pending?.decision;
      if (decision) await this.awaitDecision(s, decision);
      return this.result(s);
    }
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
  private async discover(command: Extract<ComputerCommand, { op: 'discover' }>): Promise<BrokerResult> {
    if (!this.config.enabled) throw new Error('COMPUTER_DISABLED');
    if (!this.host.isVisible()) throw new Error('COMPUTER_LOCAL_UI_REQUIRED');
    if (this.busy || this.discovery || this.stopping || (this.session && this.session.status !== 'stopped' && (this.session.owner !== command.owner || this.session.status !== 'ready'))) throw new Error('COMPUTER_BUSY');
    const controller = new AbortController(); this.discovery = { controller, owner: command.owner, id: command.sessionId }; this.busy = true;
    try {
      const found = await this.driver.discover(command.query, controller.signal);
      controller.signal.throwIfAborted();
      if (!this.host.isVisible()) throw new Error('COMPUTER_LOCAL_UI_REQUIRED');
      for (const [ref, app] of this.apps) if (app.owner === command.owner || app.expires <= this.now()) this.apps.delete(ref);
      const apps = found.slice(0, 100).map(app => {
        const appRef = randomUUID();
        this.apps.set(appRef, { owner: command.owner, appId: app.appId, name: app.name, expires: this.now() + 300_000 });
        return { appRef, name: app.name, running: app.running };
      });
      while (this.apps.size > 500) this.apps.delete(this.apps.keys().next().value!);
      return { status: 'ready', sessionId: command.sessionId, brokerEpoch: this.epoch, generation: 0, apps };
    } finally {
      try { if (!this.session || this.session.status === 'stopped') await this.driver.stop(); }
      finally { this.discovery = undefined; this.busy = false; }
    }
  }
  private async open(command: Extract<ComputerCommand, { op: 'open' }>): Promise<BrokerResult> {
    if (!this.config.enabled) throw new Error('COMPUTER_DISABLED');
    if (!this.host.isVisible()) throw new Error('COMPUTER_LOCAL_UI_REQUIRED');
    if (this.stopping) throw new Error('COMPUTER_STOPPING');
    if (this.discovery || this.busy) throw new Error('COMPUTER_BUSY');
    if (this.session && this.session.status !== 'stopped') {
      const s = this.session;
      if (s.id !== command.sessionId || s.owner !== command.owner || s.appRef !== command.appRef || s.mode !== command.mode || s.prepare !== command.prepare || s.windowRef !== command.windowRef || JSON.stringify(s.model) !== JSON.stringify(command.model)) throw new Error('COMPUTER_DEVICE_BUSY');
      return this.result(s);
    }
    const app = this.apps.get(command.appRef);
    if (!app || app.owner !== command.owner || app.expires <= this.now()) throw new Error('COMPUTER_APP_REF_EXPIRED');
    const s: Session = { id: command.sessionId, owner: command.owner, appId: app.appId, model: command.model,
      appRef: command.appRef, mode: command.mode, prepare: command.prepare, windowRef: command.windowRef,
      grantId: randomUUID(), generation: 0, status: 'pending_authorization', createdAt: this.now(), touchedAt: this.now(),
      controller: new AbortController(), receipts: new Map(), actions: 0 };
    this.session = s;
    // Catalog metadata is discoverable, but window contents and preparation require consent.
    const preparation = this.host.requestApproval({ kind: 'session', id: s.id, appId: s.appId, appName: app.name, mode: s.mode, prepare: s.prepare, model: s.model }, s.controller.signal).then(async (approved) => {
      this.active(s);
      if (!approved) { await this.stop(); return; }
      s.target = await this.driver.resolveTarget(s.appId, s.controller.signal, { prepare: s.prepare, windowRef: s.windowRef });
      this.active(s);
      if (s.target.appId !== s.appId) throw new Error('COMPUTER_TARGET_MISMATCH');
      s.status = 'ready'; s.touchedAt = this.now();
    }).catch((error) => {
      if (this.session !== s) return;
      s.errorCode = error instanceof Error && /^COMPUTER_[A-Z_]+$/.test(error.message) ? error.message : 'COMPUTER_NATIVE_SETUP_FAILED';
      if (error instanceof ComputerTargetError) s.windows = error.windows;
      return this.stop().catch(() => {});
    }).finally(() => this.host.onStateChange?.());
    s.preparation = preparation;
    if (!this.host.deferApproval) await this.awaitDecision(s, preparation);
    return this.result(s);
  }
  private async awaitDecision<T>(s: Session, decision: Promise<T>): Promise<T | undefined> {
    if (s.controller.signal.aborted) return;
    let abort!: () => void;
    const cancelled = new Promise<undefined>(resolve => {
      abort = () => resolve(undefined);
      s.controller.signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([decision, cancelled]); }
    finally { s.controller.signal.removeEventListener('abort', abort); }
  }
  private async observe(s: Session): Promise<BrokerResult> {
    let frame: DriverObservation | undefined;
    try {
    frame = await this.driver.observe(s.target!, s.controller.signal);
    const validateFrame = () => {
      this.active(s);
      if (frame.target.appId !== s.appId || frame.target.processIdentity !== s.target!.processIdentity || frame.target.windowId !== s.target!.windowId) throw new Error('COMPUTER_TARGET_CHANGED');
      if (frame.image.byteLength > COMPUTER_FRAME_MAX_BYTES || frame.imageWidth * frame.imageHeight > COMPUTER_FRAME_MAX_PIXELS) throw new Error('COMPUTER_FRAME_LIMIT');
    };
    validateFrame();
    // Avoid giving the model an intermediate caret-fade frame that may never
    // recur exactly. Native editors need a repeated identical full snapshot;
    // the later pre-dispatch comparison still uses the full unmasked digest.
    let editable = false;
    try {
      const data = JSON.parse(frame.summary);
      editable = Array.isArray(data.elements) && data.elements.some((e: Record<string, unknown>) =>
        ['AXTextField', 'AXTextArea'].includes(String(e.role)) && e.in_web_content !== true);
    } catch { /* Missing structured context keeps the ordinary capture path. */ }
    if (editable) {
      let stable = false;
      const fingerprint = () => JSON.stringify([frame.stateDigest, frame.target]);
      const seen = new Set([fingerprint()]);
      for (let sample = 0; sample < 5; sample++) {
        this.active(s);
        const next = await this.driver.observe(s.target!, s.controller.signal);
        const previous = frame; frame = next;
        previous.image.fill(0);
        validateFrame();
        const current = fingerprint();
        stable = seen.has(current);
        if (stable) break;
        seen.add(current);
      }
      if (!stable) throw new Error('COMPUTER_UI_UNSTABLE');
    }
    validateFrame();
    s.target = frame.target;
    s.observation = { id: randomUUID(), sessionId: s.id, brokerEpoch: this.epoch, generation: s.generation,
      target: frame.target, capturedAt: this.now(), imageWidth: frame.imageWidth, imageHeight: frame.imageHeight,
      summary: frame.summary.slice(0, 12_000), focusedEditableRef: frame.focusedEditableRef, stateDigest: frame.stateDigest };
    s.touchedAt = this.now();
    return { ...this.result(s), observation: s.observation, frame: { bytes: frame.image, mimeType: frame.mimeType } };
    } catch (error) {
      frame?.image.fill(0);
      s.errorCode ??= error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message) ? error.message : 'COMPUTER_OBSERVE_FAILED';
      await this.stop().catch(() => {
        log.warn({ sessionId: s.id, phase: 'cleanup' }, 'Computer driver cleanup failed after observation failure');
      });
      throw error;
    }
  }
  private async act(s: Session, raw: import('@xopcai/computer-control-contract').ActionEnvelope): Promise<BrokerResult> {
    if (s.mode === 'observe') throw new Error('COMPUTER_READ_ONLY');
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
    if (s.actions + computerActionInputCount(e.action) > this.config.maxActionsPerSession) throw new Error('COMPUTER_ACTION_BUDGET');
    const inputs = computerActionInputs(e.action);
    const points = inputs.flatMap(action => action.kind === 'drag' ? [action.from, action.to]
      : 'point' in action && action.point ? [action.point] : []);
    if (points.some(point => point.x >= observed.imageWidth || point.y >= observed.imageHeight)) throw new Error('COMPUTER_COORDINATE_OUTSIDE_WINDOW');
    if (inputs.some(action => action.kind === 'typeText' && !action.point && !observed.focusedEditableRef)) throw new Error('COMPUTER_EDITABLE_TARGET_REQUIRED');
    this.driver.validateAction?.(e.action);
    if (e.action.kind !== 'wait') {
      if (!s.pending) {
        s.pending = { envelope: e, digest }; s.status = 'pending_action';
        const decision = this.host.requestApproval({ kind: 'action', id: e.actionId, target: observed.target, action: e.action }, s.controller.signal).then((approved) => {
          this.active(s);
          if (s.pending?.digest === digest) s.pending.approved = approved;
        }).catch(async error => {
          if (this.session !== s) return;
          s.errorCode ??= error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message) ? error.message : 'COMPUTER_APP_NOT_AUTHORIZED';
          await this.stop();
        }).finally(() => this.host.onStateChange?.());
        s.pending.decision = decision;
        if (this.host.deferApproval) return this.result(s);
        await this.awaitDecision(s, decision);
        if (s.controller.signal.aborted) return this.result(s);
      }
      if (s.pending.digest !== digest) throw new Error('COMPUTER_DIFFERENT_ACTION_PENDING');
      if (s.pending.approved === undefined) return this.result(s);
      if (!s.pending.approved) { await this.stop(); return this.result(s); }
    }
    const precheckStarted = this.durationNow();
    let matched = false;
    let precheckSamples = 0;
    // A blinking insertion caret can change pixels while the application is
    // otherwise unchanged. Resample before any dispatch, without masking pixels
    // or weakening the original full target/digest comparison. A persistent
    // change still refuses the envelope and uses the existing bounded rescue.
    for (let sample = 0; sample < 4; sample++) {
      precheckSamples++;
      if (sample) await delay(100, undefined, { signal: s.controller.signal });
      let current: DriverObservation;
      try { current = await this.driver.observe(s.target!, s.controller.signal); }
      catch (error) {
        s.errorCode ??= error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message) ? error.message : 'COMPUTER_OBSERVE_FAILED';
        await this.stop().catch(() => {}); throw error;
      }
      try {
        this.active(s);
        const sameTarget = JSON.stringify(current.target) === JSON.stringify(observed.target);
        if (!sameTarget || e.deadlineAt <= this.now()) break;
        if (current.stateDigest !== observed.stateDigest) continue;
        this.driver.validateAction?.(e.action);
        matched = true;
        break;
      } finally { current.image.fill(0); }
    }
    if (!matched) {
      s.pending = undefined; s.observation = undefined; s.status = 'ready';
      return { ...this.result(s), errorCode: 'COMPUTER_OBSERVATION_CHANGED' };
    }
    const nativeMs: ComputerNativeTiming = { precheckMs: Math.max(0, Math.round(this.durationNow() - precheckStarted)), inputMs: 0, postObserveMs: 0, precheckSamples };
    const grouped = e.action.kind === 'activateSequence' || e.action.kind === 'batch';
    const receipt: ComputerReceipt = { actionId: e.actionId,
      ...(grouped ? { inputCount: inputs.length, steps: inputs.map((_, index) => ({ index, dispatch: 'notStarted' as const })) } : {}),
      dispatch: 'started', outcome: 'unknown', verification: 'none' };
    s.receipts.set(e.actionId, { digest, receipt }); s.actions += computerActionInputCount(e.action); s.pending = undefined; s.status = 'running';
    try {
      const inputStarted = this.durationNow();
      try {
        if (grouped) await this.driver.perform(s.target!, e.action, s.controller.signal, (index, dispatch) => {
          if (dispatch === 'started') {
            this.active(s);
            if (e.deadlineAt <= this.now()) throw new Error('COMPUTER_STALE_ACTION');
          }
          if (!receipt.steps?.[index]) throw new Error('COMPUTER_RECEIPT_MISMATCH');
          receipt.steps[index].dispatch = dispatch;
        });
        else await this.driver.perform(s.target!, e.action, s.controller.signal);
      }
      finally {
        nativeMs.inputMs = Math.max(0, Math.round(this.durationNow() - inputStarted));
        nativeMs.inputDetail = this.driver.getLastInputTiming?.();
      }
      this.active(s);
      receipt.dispatch = 'completed';
      for (const step of receipt.steps ?? []) step.dispatch = 'completed';
      s.status = 'ready';
      const observationStarted = this.durationNow();
      let after: BrokerResult;
      try { after = await this.observe(s); }
      finally { nativeMs.postObserveMs = Math.max(0, Math.round(this.durationNow() - observationStarted)); }
      // A changed screenshot is observation evidence, not proof of business success.
      receipt.verification = after.observation ? 'visual' : 'none';
      return { ...after, receipt, nativeMs };
    } catch (error) {
      if (receipt.dispatch === 'started') receipt.dispatch = 'unknown';
      receipt.errorCode = error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message)
        ? error.message : receipt.dispatch === 'completed' ? 'COMPUTER_POST_ACTION_OBSERVATION_FAILED' : 'COMPUTER_NATIVE_ACTION_FAILED';
      s.errorCode = receipt.errorCode;
      await this.stop().catch(() => {
        log.warn({ sessionId: s.id, actionId: e.actionId, phase: 'cleanup' }, 'Computer driver cleanup failed after session revocation');
      });
      return { ...this.result(s), receipt, nativeMs };
    }
  }
  stop(errorCode?: 'COMPUTER_LOCAL_UI_REQUIRED'): Promise<void> {
    this.discovery?.controller.abort();
    const s = this.session;
    if (s && s.status !== 'stopped') {
      s.errorCode ??= errorCode;
      s.generation++; s.status = 'stopped'; s.pending = undefined; s.observation = undefined;
      s.controller.abort();
    }
    if (!this.stopping) this.stopping = this.driver.stop().finally(() => { this.stopping = undefined; this.host.onStateChange?.(); });
    return this.stopping;
  }
  async cancel(command: ComputerCommand): Promise<void> {
    if ((this.session?.id === command.sessionId && this.session.owner === command.owner)
      || (this.discovery?.id === command.sessionId && this.discovery.owner === command.owner)) await this.stop();
  }
  snapshot(): { status: Status | 'idle'; errorCode?: string; appId?: string; preparation?: { startedAt: number }; dispatch?: ComputerReceipt['dispatch'] } {
    const preparation = this.session?.status === 'pending_authorization' ? this.driver.getPreparationState?.() : undefined;
    return this.session ? { status: this.session.status, errorCode: this.session.errorCode, appId: this.session.appId,
      dispatch: [...this.session.receipts.values()].at(-1)?.receipt.dispatch ?? 'notStarted',
      ...(preparation ? { preparation } : {}) } : { status: 'idle' };
  }
  async dispose(): Promise<void> { clearInterval(this.timer); await this.stop(); }
}
