import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { PhoneExecutionTrace, currentPhoneTrace, measurePhonePhase } from './execution-trace.js';
import { phoneAllowsApp, phoneAppAccess } from './app-access.js';
import { nativePhoneOutput, updatePhoneFeedback } from './task-feedback.js';
import { PhoneFrameCache, PhoneOperationBudget } from './live-state.js';
import { PhoneInteractiveSession } from './interactive-session.js';
import { LocalScrcpyProvider } from './scrcpy.js';
import type { PhoneInteractiveProvider } from './live-provider.js';

import { createLogger } from '../utils/logger.js';
import { pendingPhoneAssistance, phoneAssistance, updatePhoneCheckpoint, type PhoneCheckpoint } from './assistance.js';

import type { Config } from '../config/schema.js';
import { resolveEffectiveAgentConfigForAgent } from '../config/agent-profile.js';
import { CloudPhones } from './cloud-phones.js';
import { PhoneLocationEnvironment } from './location-environment.js';
import { WirelessPhones } from './wireless.js';
import { AdbPhoneDriver, resolveAdbPath, type PhoneDriver } from './adb-driver.js';
import { createPhoneModel, isAboutScreen, type PhoneModelAdapter, type PhoneModelDecision, type PhoneTrajectoryEntry } from './model-adapter.js';
import { PhoneRepository } from './repository.js';
import { PHONE_COMPLETION_CORRECTIONS, phoneCompletionGuidance, phoneCompletionRecoveryHint } from './completion-recovery.js';
import { canDispatchPhoneAction, observationSignature, phoneCompletionSatisfied } from './reliability.js';
import { groundPhoneCoordinateAction, resolvePhoneSemanticAction } from './semantic-controls.js';
import { advancePhonePlan, buildPhonePlan, createPhonePlanState, type PhonePlanState } from './planning.js';
import { confirmPhoneFocusRecovery, phoneBackRecovery, phoneUnfocusedTypingHint, preparePhoneFocusRecovery, type PhoneFocusRecovery } from './recovery.js';
import { createPhoneNumericEntry, nextPhoneNumericEntry, type PhoneNumericEntryIntent, type PhoneNumericEntryStep } from './numeric-entry.js';
import {
  MOCK_PHONE_MODEL, PhoneError, PhoneInputSchema, type PhoneAction, type PhoneDevice, type PhoneInput,
  type PhoneApplication, type PhoneObservation, type PhoneReport, type PhoneExecutionMode,
} from './contracts.js';

type ExecutionContext = { config: Config; agentId: string; modelRef?: string; preferredDeviceId?: string; toolDenied?: boolean; validateBinding?: () => boolean; assistanceId?: string; onNeedsUser?: (checkpoint: PhoneCheckpoint) => string | undefined };
const VIEW_MODEL = 'phone-view-only';
type Session = {
  report: PhoneReport; device: PhoneDevice; lease: string; driver: PhoneDriver; adapter: PhoneModelAdapter;
  controller: AbortController; active?: Promise<unknown>; createdAt: number; modelRef: string; adbPath: string;
  context: ExecutionContext; frames: PhoneFrameCache; io: Promise<unknown>; ioBusy: boolean;
  prediction?: AbortController; budget?: PhoneOperationBudget; wake: Set<() => void>;
  authorizeHuman?: () => void;
  human?: string; humanExpiresAt?: number; viewedAt: number; preview?: Promise<void>;
  commands: Promise<unknown>; receipts: Map<string, { hash: string; result: Promise<unknown> }>;
  applications: PhoneApplication[];
  trajectory: PhoneTrajectoryEntry[];
  trajectoryCount: number;
  trajectorySummary: string[];
  stream?: PhoneInteractiveSession;
  streamOpening?: Promise<PhoneInteractiveSession>;
  videoGeneration?: symbol;
  taskPending?: boolean;
  segmentUsage?: { actions: number; modelRequests: number; activeDurationMs: number };
  taskActiveMs?: number;
  switching?: boolean;
  modeHandbackRequired?: boolean;
  taskStart?: { actions: number; modelRequests: number };

};
const log = createLogger('PhoneRuntime');
const terminal = new Set(['closed']);

/** Keep visible list content across scrolling without retaining pixels or password fields. */
function phoneTrajectoryFacts(observation: PhoneObservation): string[] {
  return [...new Set(observation.elements.filter(node => !node.password
    && node.bounds[0] >= 0 && node.bounds[1] >= 0
    && node.bounds[2] <= observation.width && node.bounds[3] <= observation.height
    && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1])
    .flatMap(node => [node.text, node.description]).filter(Boolean))].slice(0, 40).map(text => text.slice(0, 200));
}

export class PhoneRuntime {
  private reconnecting = new Map<string, Promise<PhoneDevice>>();
  private reconnectAfter = new Map<string, number>();
  private cloudPhones?: CloudPhones;
  private locationEnvironment?: PhoneLocationEnvironment;
  get environment(): PhoneLocationEnvironment {
    return this.locationEnvironment ??= new PhoneLocationEnvironment(this.repository, {
      adapter: device => this.cloud.locationAdapter(device),
      exclusive: (phoneId, owner, cleanup, action) => this.withEnvironmentLock(phoneId, owner, cleanup, action),
    });
  }
  private async withEnvironmentLock<T>(phoneId: string, owner: string, cleanup: boolean, action: () => Promise<T>): Promise<T> {
    const device = this.repository.get(phoneId);
    if (this.deviceOpenings.has(phoneId)) throw new PhoneError('PHONE_DEVICE_BUSY', 'Phone environment is busy', 409);
    const session = [...this.sessions.values()].find(value => value.device.id === phoneId && value.report.status !== 'closed');
    if (session && cleanup && !['closed', 'cancelled', 'completed'].includes(session.report.status)) await this.stop(session.report.owner, 'pause');
    if (session && !cleanup && (session.report.owner !== owner || session.active && !this.locationEnvironment?.hasVerified(phoneId, owner))) throw new PhoneError('PHONE_DEVICE_BUSY', 'Pause the phone task before sharing location', 409);
    const opening = new AbortController(); this.deviceOpenings.set(phoneId, opening);
    let lease: string | undefined;
    try {
      if (session) {
        this.repository.renew(device.serial, session.lease);
        const result = await this.io(session, action);
        session.report.controlEpoch!++; session.frames.invalidate(); this.publish(session);
        return result;
      }
      lease = this.repository.acquire(device.serial);
      return await action();
    } finally { if (lease) this.repository.release(device.serial, lease); if (this.deviceOpenings.get(phoneId) === opening) this.deviceOpenings.delete(phoneId); }
  }
  get cloud(): CloudPhones { return this.cloudPhones ??= new CloudPhones(this.repository); }
  private sessions = new Map<string, Session>();
  private listeners = new Map<string, Set<(report: PhoneReport) => void>>();
  private lastDevices = new Map<string, string>();
  private openings = new Map<string, AbortController>();
  private deviceOpenings = new Map<string, AbortController>();
  private maintenance?: ReturnType<typeof setInterval>;
  constructor(
    readonly repository = new PhoneRepository(),
    private driverFactory: (path: string) => PhoneDriver = path => new AdbPhoneDriver(path),
    private modelFactory = createPhoneModel,
    private interactiveFactory: (adb: string, serial: string, failed: () => void) => PhoneInteractiveProvider = (adb, serial, failed) => new LocalScrcpyProvider(adb, serial, failed),
    readonly wireless = new WirelessPhones(),
  ) {}

  async driverFor(device: PhoneDevice, config: Config): Promise<PhoneDriver> {
    return device.connection ? this.cloud.driver(device) : this.driverFactory(resolveAdbPath(config.phone.adbPath));
  }
  async discover(config: Config, signal?: AbortSignal) {
    const driver = this.driverFactory(resolveAdbPath(config.phone.adbPath));
    let devices = await driver.discover(signal);
    const missing = this.repository.list().filter(device => device.enabled && device.wireless
      && !devices.some(item => item.serial === device.serial && item.state === 'device') && (this.reconnectAfter.get(device.id) ?? 0) < Date.now()).slice(0, 2);
    const reconnectSignal = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    await Promise.all(missing.map(async device => {
      this.reconnectAfter.set(device.id, Date.now() + 30_000);
      await this.reconnectWireless(device.id, config, reconnectSignal).catch(() => { signal?.throwIfAborted(); });
    }));
    if (missing.length) devices = await driver.discover(signal);
    return devices;
  }
  reconnectWireless(id: string, config: Config, signal?: AbortSignal, endpoint?: { host: string; port: number }): Promise<PhoneDevice> {
    const active = this.reconnecting.get(id); if (active) return active;
    const task = (async () => {
      const device = this.repository.get(id);
      if (!device.wireless || device.connection) throw new PhoneError('PHONE_NOT_WIRELESS', 'Choose a registered wireless phone');
      if (!device.enabled) throw new PhoneError('PHONE_DEVICE_DENIED', 'Phone access is disabled', 403);
      await Promise.all(this.reports().filter(report => report.deviceId === id).map(report => this.stop(report.owner, 'close')));
      this.cloudPhones?.disconnect(id);
      const result = await this.wireless.reconnect(resolveAdbPath(config.phone.adbPath), device.wireless, signal, endpoint);
      const current = this.repository.get(id);
      if (current.revision !== device.revision) throw new PhoneError('PHONE_DEVICE_CHANGED', 'Phone settings changed; retry connection', 409);
      return this.repository.save({ ...current, serial: result.device.serial, wireless: result.wireless }, id);
    })().finally(() => this.reconnecting.delete(id));
    this.reconnecting.set(id, task); return task;
  }
  async applications(input: { deviceId?: string; serial?: string }, config: Config, signal: AbortSignal): Promise<PhoneApplication[]> {
    let driver: PhoneDriver; let serial: string;
    if (input.deviceId) {
      const device = this.repository.get(input.deviceId);
      if (!device.enabled) throw new PhoneError('PHONE_DEVICE_DENIED', 'Phone access is disabled', 403);
      driver = await this.driverFor(device, config); serial = device.serial;
    } else {
      const found = (await this.discover(config, signal)).find(device => device.serial === input.serial && device.state === 'device');
      if (!found) throw new PhoneError('PHONE_DEVICE_OFFLINE', 'Choose a connected and authorized phone');
      driver = this.driverFactory(resolveAdbPath(config.phone.adbPath)); serial = found.serial;
    }
    if (!driver.applications) throw new PhoneError('PHONE_APPS_UNAVAILABLE', 'The phone provider cannot list applications');
    return driver.applications(serial, signal);
  }
  async textInputStatus(id: string, config: Config, signal: AbortSignal) {
    const device = this.repository.get(id);
    if (!device.enabled) throw new PhoneError('PHONE_DEVICE_DENIED', 'Phone access is disabled', 403);
    const driver = await this.driverFor(device, config);
    if (!driver.textInputStatus) throw new PhoneError('PHONE_TEXT_INPUT_UNAVAILABLE', 'This phone provider does not expose text input diagnostics', 409);
    return { ...await driver.textInputStatus(device.serial, signal), policy: device.textInput ?? 'auto' };
  }
  async preview(id: string, config: Config, signal: AbortSignal): Promise<PhoneObservation> {
    const device = this.repository.get(id);
    if (!device.enabled) throw new PhoneError('PHONE_DEVICE_DENIED', 'Phone access is disabled', 403);
    const connected = [...this.sessions.values()].find(session => session.device.id === id && session.report.status !== 'closed');
    if (connected) {
      this.guard(connected, { ...connected.context, config });
      const observation = await this.observe(connected, signal);
      try { this.allowedScreen(connected, observation); return observation; }
      catch (error) { observation.frame.fill(0); throw error; }
    }
    const lease = this.repository.acquire(device.serial);
    let driver: PhoneDriver | undefined;
    try {
      driver = await this.driverFor(device, config);
      const observation = await driver.observe(device.serial, signal);
      if (!phoneAllowsApp(device, observation.package)) { observation.frame.fill(0); throw new PhoneError('PHONE_APP_DENIED', 'Open an allowed app before previewing the screen'); }
      return observation;
    } finally {
      // Temporary previews must relinquish accessibility ownership before the lease.
      try { await driver?.releaseInput?.(); }
      finally { this.repository.release(device.serial, lease); }
    }
  }
  async previewSession(owner: string, context: ExecutionContext, signal: AbortSignal): Promise<PhoneObservation> {
    const session = this.sessions.get(owner);
    if (!session || terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Open a phone session first');
    this.guard(session, context);
    const observation = await this.observe(session, signal);
    try { this.allowedScreen(session, observation); return observation; }
    catch (error) { observation.frame.fill(0); throw error; }
  }
  reports(): PhoneReport[] {
    return [...this.sessions.values()].map(session => structuredClone(session.report));
  }
  status(owner: string): PhoneReport | undefined { const report = this.sessions.get(owner)?.report; return report && structuredClone(report); }
  private checkpoint(session: Session): PhoneCheckpoint {
    const { sessionId, deviceId, deviceName, owner, agentId, modelRef, executionMode } = session.report;
    return { report: { sessionId, deviceId, deviceName, owner, agentId, modelRef, executionMode }, deviceRevision: session.device.revision,
      task: structuredClone(session.report.task!), usage: {
        actions: session.report.actions - (session.report.humanActions ?? 0) - (session.taskStart?.actions ?? 0),
        modelRequests: session.report.modelRequests - (session.taskStart?.modelRequests ?? 0),
        activeDurationMs: (session.taskActiveMs ?? 0) + (session.budget?.elapsedMs ?? 0),
      } };
  }
  async restoreAssistance(checkpoint: PhoneCheckpoint, context: ExecutionContext, signal?: AbortSignal, assistanceId?: string): Promise<PhoneReport> {
    const { owner, deviceId, agentId, modelRef } = checkpoint.report;
    if (context.agentId !== agentId || context.modelRef !== modelRef || this.repository.get(deviceId).revision !== checkpoint.deviceRevision)
      throw new PhoneError('PHONE_BINDING_CHANGED', 'Phone or Agent settings changed. Inspect the task before restarting.', 409);
    const existing = this.sessions.get(owner);
    if (existing && existing.report.status !== 'closed') {
      this.guard(existing, context);
      if (existing.report.deviceId !== deviceId || existing.report.task && existing.report.task.taskId !== checkpoint.task.taskId)
        throw new PhoneError('PHONE_ASSISTANCE_CHANGED', 'Another phone task is active', 409);
      if (existing.report.task) {
        existing.report.assistanceId = assistanceId ?? existing.report.assistanceId;
        return this.publish(existing);
      }
      if (existing.active || existing.human) throw this.busy(deviceId, existing);
    }
    if (!existing || existing.report.status === 'closed') await this.execute(owner, { op: 'open', deviceId, mode: 'control' }, { ...context, assistanceId }, signal);
    const session = this.sessions.get(owner)!;
    session.report.task = structuredClone(checkpoint.task); session.taskPending = true;
    session.report.executionMode = checkpoint.task.executionMode;
    session.report.actions = checkpoint.usage.actions; session.report.modelRequests = checkpoint.usage.modelRequests;
    session.taskStart = { actions: 0, modelRequests: 0 }; session.taskActiveMs = checkpoint.usage.activeDurationMs;
    session.report.status = 'needs_user'; session.report.stopReason = 'user_takeover';
    session.report.assistanceId = assistanceId;
    session.report.controlOwner = 'none'; session.report.controlEpoch!++;
    return this.publish(session);
  }
  subscribe(owner: string, listener: (report: PhoneReport) => void): () => void {
    const listeners = this.listeners.get(owner) ?? new Set();
    listeners.add(listener); this.listeners.set(owner, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(owner); };
  }
  deviceContext(id: string, config: Config): ExecutionContext {
    const session = [...this.sessions.values()].find(session => session.device.id === id && session.report.status !== 'closed');
    if (!session) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone is not connected', 404);
    return { ...session.context, config };
  }
  async viewDevice(id: string, config: Config, agentId: string, signal?: AbortSignal): Promise<void> {
    if ([...this.sessions.values()].some(session => session.device.id === id && session.report.status !== 'closed')) return;
    const owner = `phone-view:${id}`;
    await this.execute(owner, { op: 'open', deviceId: id, mode: 'observe' }, { config, agentId, modelRef: VIEW_MODEL }, signal);
    await this.finishTask(owner);
  }
  updateConnectionPolicy(config: Config): void {
    for (const session of this.sessions.values()) session.context = { ...session.context, config };
  }
  async releaseConversation(owner: string): Promise<void> {
    const session = this.sessions.get(owner);
    if (!session || session.report.status === 'closed') return;
    if (this.deviceOpenings.has(session.device.id)) return;
    if (session.active) { await this.stop(owner, 'cancel'); return; }
    const wait = phoneAssistance(owner);
    if (wait && ['open', 'queued', 'resuming'].includes(wait.status) && session.report.task?.taskId === wait.checkpoint.task.taskId
      && session.report.status !== 'completed') {
      if (!session.human) { session.report.status = 'needs_user'; session.report.controlOwner = 'none'; this.publish(session); }
      return;
    }
    if (!session.human && !['paused', 'needs_user', 'failed', 'outcome_unknown'].includes(session.report.status)) await this.finishTask(owner);
  }
  private publish(session: Session): PhoneReport {
    const trace = currentPhoneTrace();
    if (trace) session.report.performance = trace.snapshot();
    session.report.nextExecutionMode = this.repository.executionMode(session.report.owner) ?? session.context.config.phone.executionMode;
    if (session.report.feedback && session.segmentUsage) session.report.feedback = updatePhoneFeedback(session.report, {
      actions: session.report.actions - session.segmentUsage.actions,
      modelRequests: session.report.modelRequests - session.segmentUsage.modelRequests,
      activeDurationMs: session.segmentUsage.activeDurationMs + (session.budget?.elapsedMs ?? 0),
    }, session.report.feedback);
    session.report.revision = (session.report.revision ?? 0) + 1;
    session.report.hasPendingTask = Boolean(session.taskPending);
    session.report.updatedAt = Date.now();
    if (session.report.task) updatePhoneCheckpoint(session.report.owner, this.checkpoint(session));
    this.repository.report(session.report);
    for (const listener of this.listeners.get(session.report.owner) ?? []) {
      try { listener(structuredClone(session.report)); }
      catch { log.warn({ conversationId: session.report.owner, phase: 'report_listener' }, 'Phone progress listener failed'); }
    }
    return structuredClone(session.report);
  }
  private guard(session: Session, context: ExecutionContext, requireLocation = true): void {
    if (requireLocation) this.locationEnvironment?.assertAllowed(session.device.id, session.report.owner);
    if (!context.config.phone.enabled || context.toolDenied) throw new PhoneError('PHONE_DISABLED', 'Phone Use is disabled for this agent');
    if (context.modelRef !== session.modelRef || resolveAdbPath(context.config.phone.adbPath) !== session.adbPath) throw new PhoneError('PHONE_BINDING_CHANGED', 'Phone model or execution configuration changed; reopen the phone');
    if (context.validateBinding && !context.validateBinding()) throw new PhoneError('PHONE_BINDING_CHANGED', 'Agent model or tool policy changed; reopen the phone');
    const current = this.repository.get(session.device.id);
    if (!current.enabled || current.revision !== session.device.revision) throw new PhoneError('PHONE_ACCESS_CHANGED', 'Device access changed; reopen the phone');
    this.repository.renew(session.device.serial, session.lease);
  }
  private allowedScreen(session: Session, observation: PhoneObservation): void {
    if (!phoneAllowsApp(session.device, observation.package)) throw new PhoneError('PHONE_APP_DENIED', 'The foreground application is outside this phone session allowlist. Open an allowed app or reopen with appPackage.');
  }
  async execute(owner: string, raw: PhoneInput, context: ExecutionContext, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
    if (!['open', 'run', 'step', 'observe'].includes(raw.op)) return this.executeInput(owner, raw, context, signal);
    const trace = new PhoneExecutionTrace();
    return trace.run(async () => {
      try {
        const result = await this.executeInput(owner, raw, context, signal);
        const session = this.sessions.get(owner);
        if (session?.report.performance?.operationId === trace.id) session.report.performance = trace.snapshot();
        return result && typeof result === 'object' && 'sessionId' in result ? { ...result, performance: trace.snapshot() } : result;
      } finally {
        trace.finish();
        log.info({ conversationId: owner, op: raw.op, modelRef: context.modelRef, phase: 'execution_timing',
          performance: trace.snapshot() }, 'Phone execution timing recorded');
      }
    });
  }
  private async executeInput(owner: string, raw: PhoneInput, context: ExecutionContext, signal: AbortSignal): Promise<unknown> {
    const input = PhoneInputSchema.parse(raw);
    if (input.op === 'request_user') {
      const session = this.sessions.get(owner);
      if (!session?.report.task || terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Start a phone task before requesting user assistance', 409);
      this.guard(session, context);
      if (session.human || session.active || session.switching) throw new PhoneError('PHONE_SESSION_BUSY', 'Wait for the current phone operation before requesting user assistance', 409);
      if (session.report.status === 'outcome_unknown') throw new PhoneError('PHONE_DISPATCH_UNKNOWN', 'Inspect the previous input before continuing', 409);
      session.controller.abort(); session.prediction?.abort(); session.budget?.pause();
      session.report.status = 'needs_user'; session.report.stopReason = 'user_takeover'; session.report.message = input.reason;
      session.report.controlOwner = 'none'; session.report.controlEpoch!++; session.report.verified = false;
      session.report.assistanceId = context.onNeedsUser?.(this.checkpoint(session));
      this.publish(session);
      await session.stream?.revoke();
      return this.publish(session);
    }
    if (input.op === 'close') return this.finishTask(owner);
    if (['cancel', 'close', 'pause'].includes(input.op)) return this.stop(owner, input.op as 'cancel' | 'close' | 'pause');
    if (input.op === 'status') return this.status(owner) ?? { status: 'closed' };
    if (!context.config.phone.enabled || context.toolDenied) throw new PhoneError('PHONE_DISABLED', 'Enable Phone Use in settings and allow the tool for this agent');
    if (input.op === 'set_mode') return { executionMode: input.executionMode, report: await this.setExecutionMode(owner, input.executionMode, context, input.applyCurrent) };
    if (input.op === 'discover') return { executionMode: this.repository.executionMode(owner) ?? context.config.phone.executionMode, devices: this.repository.list().filter(device => device.enabled), defaultDeviceId: context.preferredDeviceId ?? this.repository.defaultDevice(), systemDefaultDeviceId: this.repository.defaultDevice() };
    signal.throwIfAborted();
    if (input.op === 'open') {
      const requestedDevice = input.deviceId ?? context.preferredDeviceId ?? this.repository.defaultDevice();
      if (requestedDevice && this.repository.get(requestedDevice).connection) await this.environment.recover(requestedDevice);
      if (requestedDevice && this.deviceOpenings.has(requestedDevice)) throw this.busy(requestedDevice);
      if (this.openings.has(owner)) throw new PhoneError('PHONE_SESSION_BUSY', 'A phone is already being opened', 409);
      const opening = new AbortController(); this.openings.set(owner, opening);
      if (requestedDevice) this.deviceOpenings.set(requestedDevice, opening);
      signal = AbortSignal.any([signal, opening.signal]);
      try {
        for (const [key, value] of this.sessions) if (terminal.has(value.report.status)) this.sessions.delete(key);
        if (this.sessions.size >= 50 && ![...this.sessions.values()].some(session => session.device.id === requestedDevice)) throw new PhoneError('PHONE_CAPACITY', 'Disconnect an idle phone in the global phone panel before opening another', 409);
        const previous = this.sessions.get(owner);
        const deviceId = requestedDevice;
        const waiting = pendingPhoneAssistance().find(wait => wait.checkpoint.report.deviceId === deviceId);
        if (waiting && waiting.id !== context.assistanceId) throw new PhoneError('PHONE_PAUSED', 'This phone has a pending user handoff. Complete or cancel that task before opening another.', 409);
        if (!deviceId) throw new PhoneError('PHONE_DEVICE_REQUIRED', 'Choose a registered phone in Phone Use settings');
        if (previous && !terminal.has(previous.report.status) && previous.device.id !== deviceId) {
          if (previous.active || previous.human || previous.report.controlOwner !== 'none' || !['ready', 'completed'].includes(previous.report.status)) throw this.busy(previous.device.id, previous);
        }
        let device = this.repository.get(deviceId);
        if (!device.enabled) throw new PhoneError('PHONE_DEVICE_DENIED', 'This phone is disabled', 403);
        const modelRef = context.modelRef;
        if (!modelRef) throw new PhoneError('PHONE_MODEL_REQUIRED', 'Choose a Phone Use model in settings');
        if (input.appPackage && (input.mode !== 'control' || !phoneAllowsApp(device, input.appPackage))) throw new PhoneError('PHONE_APP_DENIED', 'Launching requires control mode and an allowed application');
        const connected = [...this.sessions.values()].find(value => value.device.id === deviceId && !terminal.has(value.report.status));
        if (connected) {
          if (connected.active || connected.human || connected.report.handoff !== 'idle' || ['paused', 'needs_user', 'failed', 'outcome_unknown'].includes(connected.report.status)
            || (connected.report.owner !== owner && !['completed', 'ready'].includes(connected.report.status))
            || (connected.report.owner !== owner && connected.report.controlOwner !== 'none')) throw this.busy(deviceId, connected);
          if (connected.report.owner === owner && connected.report.controlOwner !== 'none') {
            this.guard(connected, context);
            if (connected.report.mode !== input.mode) throw new PhoneError('PHONE_ALREADY_OPEN', 'Finish the current task before changing phone mode', 409);
            if (input.appPackage) {
              const observation = await this.observe(connected, signal);
              try { await this.dispatch(connected, { type: 'launch', package: input.appPackage }, observation, context, signal, connected.report.controlEpoch, false, input.settingsPage); }
              finally { observation.frame.fill(0); }
            }
            return this.publish(connected);
          }
          const adapter = await this.modelFactory(modelRef, context.config, context.agentId);
          signal.throwIfAborted();
          this.guard(connected, connected.context);
          if (input.mode === 'control' && modelRef !== MOCK_PHONE_MODEL && !connected.applications.length && connected.driver.applications) {
            try { connected.applications = await connected.driver.applications(device.serial, signal); }
            catch { signal.throwIfAborted(); }
          }
          await connected.streamOpening?.catch(() => {});
          await connected.stream?.revoke();
          await connected.io;
          signal.throwIfAborted();
          this.guard(connected, connected.context);
          this.sessions.delete(connected.report.owner);
          if (previous && previous !== connected) { this.sessions.delete(owner); previous.report.owner = `phone-view:${previous.device.id}`; this.sessions.set(previous.report.owner, previous); }
          connected.report.owner = owner; connected.report.agentId = context.agentId; connected.report.modelRef = modelRef;
          connected.report.sourceConversationId = /^[\da-f]{8}-[\da-f-]{27}$/i.test(owner) ? owner : undefined;
          connected.report.mode = input.mode; connected.report.mock = modelRef === MOCK_PHONE_MODEL;
          connected.report.status = 'ready'; connected.report.controlOwner = 'agent'; connected.report.controlEpoch!++;
          connected.report.actions = 0; connected.report.modelRequests = 0; connected.report.steps = [];
          connected.report.humanActions = 0;
          connected.report.verified = false; connected.report.verificationLevel = 'none';
          connected.report.stopReason = undefined; connected.report.errorCode = undefined; connected.report.message = undefined;
          connected.report.facts = undefined; connected.report.readings = undefined; connected.report.task = undefined; connected.report.feedback = undefined; connected.report.executionMode = undefined; connected.segmentUsage = undefined; connected.taskActiveMs = 0; connected.taskStart = undefined; connected.modeHandbackRequired = false;
          connected.report.goalPreview = undefined;
          connected.adapter = adapter; connected.context = context; connected.modelRef = modelRef;
          connected.controller = new AbortController(); connected.createdAt = Date.now();
          connected.taskPending = false;
          connected.trajectory = []; connected.trajectoryCount = 0; connected.trajectorySummary = []; connected.frames.clear(); connected.receipts.clear();
          this.sessions.set(owner, connected);
          this.lastDevices.set(owner, deviceId);
          if (input.appPackage) {
            if (input.mode !== 'control' || !phoneAllowsApp(device, input.appPackage)) throw new PhoneError('PHONE_APP_DENIED', 'Launching requires control mode and an allowed application');
            const observation = await this.observe(connected, signal);
            try { await this.dispatch(connected, { type: 'launch', package: input.appPackage }, observation, context, signal, connected.report.controlEpoch, false, input.settingsPage); }
            finally { observation.frame.fill(0); }
          }
          return this.publish(connected);
        }
        const adbPath = resolveAdbPath(context.config.phone.adbPath);
        const driver = await this.driverFor(device, context.config);
        let found = (await driver.discover(signal)).find(item => item.serial === device.serial);
        if (found?.state !== 'device' && device.wireless) {
          device = await this.reconnectWireless(device.id, context.config, signal);
          found = (await driver.discover(signal)).find(item => item.serial === device.serial);
        }
        if (found?.state !== 'device') throw new PhoneError('PHONE_DEVICE_OFFLINE', 'Phone is offline or has not authorized ADB');
        if (modelRef === MOCK_PHONE_MODEL && !found.emulator) throw new PhoneError('PHONE_MOCK_EMULATOR_ONLY', 'The deterministic mock model is only enabled for local Android emulators');
        const lease = this.repository.acquire(device.serial);
        try {
          const adapter = modelRef === VIEW_MODEL ? { predict: async (): Promise<never> => { throw new PhoneError('PHONE_OBSERVE_ONLY', 'This connection is view only', 403); } } : await this.modelFactory(modelRef, context.config, context.agentId);
          signal.throwIfAborted();
          let applications: PhoneApplication[] = [];
          if (input.mode === 'control' && modelRef !== MOCK_PHONE_MODEL && driver.applications) {
            try { applications = await driver.applications(device.serial, signal); }
            catch { signal.throwIfAborted(); }
          }
          const now = Date.now();
          const session: Session = { device, driver, adapter, lease, controller: new AbortController(), createdAt: now, modelRef, adbPath,
            context, applications, trajectory: [], trajectoryCount: 0, trajectorySummary: [], frames: new PhoneFrameCache(), io: Promise.resolve(), ioBusy: false, wake: new Set(), viewedAt: 0,
            commands: Promise.resolve(), receipts: new Map(),
            report: { sessionId: randomUUID(), deviceId: device.id, deviceName: device.name, owner, agentId: context.agentId, modelRef,
              sourceConversationId: /^[\da-f]{8}-[\da-f-]{27}$/i.test(owner) ? owner : undefined,
              mock: modelRef === MOCK_PHONE_MODEL, mode: input.mode, status: 'ready', actions: 0, modelRequests: 0, controlOwner: 'agent', controlEpoch: 1, handoff: 'idle',
              createdAt: now, updatedAt: now, verified: false, verificationLevel: 'none', steps: [], diagnostics: { stalePredictions: 0, protocolRepairs: 0, unchangedActions: 0, completionCorrections: 0 } } };
          if (previous && previous.device.id !== deviceId) { this.sessions.delete(owner); previous.report.owner = `phone-view:${previous.device.id}`; this.sessions.set(previous.report.owner, previous); }
          this.sessions.set(owner, session);
          this.lastDevices.set(owner, deviceId);
          if (this.lastDevices.size > 500) this.lastDevices.delete(this.lastDevices.keys().next().value!);
          this.startMaintenance();
          if (input.appPackage) {
            if (input.mode !== 'control' || !phoneAllowsApp(device, input.appPackage)) throw new PhoneError('PHONE_APP_DENIED', 'Launching requires control mode and an allowed application');
            const epoch = session.report.controlEpoch;
            const observation = await this.observe(session, signal);
            try { await this.dispatch(session, { type: 'launch', package: input.appPackage }, observation, context, signal, epoch, false, input.settingsPage); } finally { observation.frame.fill(0); }
          }
          return this.publish(session);
        } catch (error) {
          this.repository.release(device.serial, lease);
          if (this.sessions.get(owner)?.device.id === deviceId) this.sessions.delete(owner);
          throw error;
        }
      } finally { this.openings.delete(owner); if (requestedDevice) this.deviceOpenings.delete(requestedDevice); }
    }
    const session = this.sessions.get(owner);
    if (!session || terminal.has(session.report.status)) {
      const deviceId = this.lastDevices.get(owner);
      const occupying = deviceId && [...this.sessions.values()].find(value => value.device.id === deviceId && !terminal.has(value.report.status));
      if (occupying) throw this.busy(deviceId!, occupying);
      throw new PhoneError('PHONE_OPEN_REQUIRED', 'Open a phone session first');
    }
    if (session.switching) throw new PhoneError('PHONE_SESSION_BUSY', 'Phone execution mode is changing', 409);
    if (this.deviceOpenings.has(session.device.id)) throw this.busy(session.device.id, session);
    if (session.human) throw new PhoneError('PHONE_PAUSED', 'The user controls this phone. Wait for explicit handback in the phone panel', 409);
    if (session.active) throw new PhoneError('PHONE_SESSION_BUSY', 'A phone operation is already running', 409);
    this.guard(session, context);
    if (input.op === 'resume') {
      if (session.report.status === 'needs_user') throw new PhoneError('PHONE_PAUSED', 'User assistance is required. Wait for explicit handback in the phone panel', 409);
      if (session.modeHandbackRequired) throw new PhoneError('PHONE_PAUSED', 'Inspect the phone and explicitly hand back in the phone panel after changing execution mode', 409);
      if (session.report.steps.at(-1)?.dispatch === 'unknown') throw new PhoneError('PHONE_DISPATCH_UNKNOWN', 'Inspect the previous input before continuing; do not retry automatically', 409);
      session.controller = new AbortController(); session.report.controlOwner = 'agent'; session.report.controlEpoch!++; session.report.status = 'ready'; session.report.stopReason = undefined; session.report.message = undefined;
      return this.publish(session);
    }
    if (['paused', 'needs_user', 'failed', 'outcome_unknown'].includes(session.report.status)) throw new PhoneError('PHONE_PAUSED', 'Inspect the phone and explicitly hand back control before continuing', 409);
    if (input.op === 'run' || input.op === 'step') {
      const previous = session.report.task;
      const continuing = Boolean(input.taskId && previous?.taskId === input.taskId);
      const executionMode = input.executionMode ?? (continuing ? previous!.executionMode : this.repository.executionMode(owner) ?? context.config.phone.executionMode);
      if (continuing && executionMode !== previous!.executionMode) throw new PhoneError('PHONE_MODE_SWITCH_REQUIRED', 'Pause and explicitly switch the current task before changing execution mode', 409);
      const constraints = [...new Set([...(continuing ? previous!.constraints : []), ...(input.constraints ?? [])])];
      if (constraints.length > 12) throw new PhoneError('PHONE_CONSTRAINT_LIMIT', 'A phone task supports at most 12 constraints; existing constraints cannot be removed');
      if (!continuing) { session.adapter.reset?.(); session.trajectory = []; session.trajectorySummary = []; session.taskActiveMs = 0; session.taskStart = { actions: session.report.actions - (session.report.humanActions ?? 0), modelRequests: session.report.modelRequests }; }
      session.report.task = { taskId: continuing ? previous!.taskId : input.taskId ?? randomUUID(), executionMode, goal: input.goal,
        constraints,
        requestedOutputs: input.requestedOutputs ?? (continuing ? previous!.requestedOutputs : []),
        budget: {
          maxActions: Math.min(input.budget?.maxActions ?? 80, continuing ? previous!.budget?.maxActions ?? 80 : 80),
          maxModelRequests: Math.min(input.budget?.maxModelRequests ?? 120, continuing ? previous!.budget?.maxModelRequests ?? 120 : 120),
          maxActiveDurationMs: Math.min(input.budget?.maxActiveDurationMs ?? 900_000, continuing ? previous!.budget?.maxActiveDurationMs ?? 900_000 : 900_000),
        }, completion: input.completion, expectText: input.expectText };
      session.report.executionMode = executionMode;
      session.segmentUsage = { actions: session.report.actions, modelRequests: session.report.modelRequests, activeDurationMs: 0 };
      session.report.feedback = { taskId: session.report.task.taskId, segmentId: randomUUID(), executionMode, outcome: 'running', verified: false,
        verificationLevel: 'none', progress: { completed: [], remaining: ['Current goal has not been verified'], source: 'runtime' },
        outputs: session.report.task.requestedOutputs.map(output => ({ key: output.key, verification: 'unavailable', reason: 'not_observed' })),
        evidence: [], usage: { actions: 0, modelRequests: 0, activeDurationMs: 0 }, nextAction: 'wait' };
      session.taskPending = true; session.report.goalPreview = input.goal.slice(0, 160);
    }
    if (session.report.controlOwner === 'none') { session.report.controlOwner = 'agent'; session.report.controlEpoch!++; }
    const duration = Math.min(context.config.phone.maxOperationDurationMs, context.config.phone.maxSessionDurationMs, session.report.task?.budget?.maxActiveDurationMs ?? 900_000);
    session.budget = new PhoneOperationBudget(Math.max(1, duration - (session.taskActiveMs ?? 0))); if (session.report.controlOwner === 'agent') session.budget.resume();
    const combined = AbortSignal.any([signal, session.controller.signal, session.budget.controller.signal]);
    const operation = (async () => {
      await this.perform(session, input, context, combined);
      if ((input.op === 'run' || input.op === 'step') && ['ready', 'completed'].includes(session.report.status) && session.report.task?.requestedOutputs.length) {
        const observation = await this.observe(session, combined);
        try {
          this.guard(session, context); this.allowedScreen(session, observation); this.recordObservation(session, observation);
          const conditions = input.completion || input.expectText ? { ...input.completion, requireChange: false,
            textAll: [...(input.completion?.textAll ?? []), ...(input.expectText ? [input.expectText] : [])] } : undefined;
          if (session.report.verified && conditions && !phoneCompletionSatisfied({ ...conditions, textAll: conditions.textAll.length ? conditions.textAll : undefined }, observation, true)) {
            session.report.verified = false; session.report.verificationLevel = 'none'; session.report.status = 'ready'; session.report.stopReason = 'completion_changed';
          }
          const epoch = session.report.controlEpoch;
          const visualOutputs = session.report.task.requestedOutputs.filter(request => !request.selector);
          if (visualOutputs.length > 1 && context.config.phone.batchReadings && session.adapter.readFields) await this.readOutputFields(session, observation, visualOutputs, context, combined);
          for (const request of session.report.task.requestedOutputs) {
            if (visualOutputs.length > 1 && context.config.phone.batchReadings && session.adapter.readFields) break;
            if (request.selector) continue;
            await this.readScreen(session, observation, request.description, context, combined);
            if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') break;
            const reading = session.report.readings?.at(-1);
            if (reading?.source === 'screenshot') {
              const output = session.report.feedback!.outputs.find(output => output.key === request.key)!;
              Object.assign(output, { value: reading.text.join('\n') || undefined, source: reading.source, verification: reading.verification,
                frameId: reading.frameId, capturedAt: reading.capturedAt, reason: reading.reason });
            }
          }
          this.publish(session);
        } finally { observation.frame.fill(0); }
      }
    })();
    session.active = operation;
    try { await operation; }
    catch (error) {
      if (combined.aborted && combined.reason instanceof PhoneError && combined.reason.code === 'PHONE_OPERATION_TIMEOUT'
        && !['outcome_unknown', 'closed', 'cancelled'].includes(session.report.status) && session.report.steps.at(-1)?.dispatch !== 'unknown') {
        session.report.status = 'paused'; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
        session.report.stopReason = 'operation_timeout'; session.report.errorCode = 'PHONE_OPERATION_TIMEOUT';
      }
      if (['ready', 'completed'].includes(session.report.status)) {
        session.report.status = combined.aborted ? 'cancelled' : 'failed'; session.report.verified = false; session.report.verificationLevel = 'none';
        session.report.errorCode = error instanceof PhoneError ? error.code : 'PHONE_OPERATION_FAILED'; session.report.stopReason = 'operation_failed';
      }
      if (error instanceof PhoneError && ['PHONE_ACCESS_CHANGED', 'PHONE_APP_DENIED', 'PHONE_BINDING_CHANGED'].includes(error.code)) {
        session.report.facts = undefined; session.report.readings = [];
        if (session.report.feedback) session.report.feedback.outputs = session.report.feedback.outputs.map(output => ({ key: output.key, verification: 'unavailable', reason: error.code }));
      }
      this.publish(session); throw error;
    }
    finally {
      await this.releaseInput(session);
      session.active = undefined;
      const elapsed = session.budget?.elapsedMs ?? 0;
      session.taskActiveMs = (session.taskActiveMs ?? 0) + elapsed;
      if (session.segmentUsage) session.segmentUsage.activeDurationMs += elapsed;
      session.budget?.dispose(); session.budget = undefined;
      if (session.report.status === 'cancelled' && !session.controller.signal.aborted) {
        session.report.status = 'ready'; session.taskPending = false;
      }
      if (session.report.status === 'completed') { session.taskPending = false; await this.locationEnvironment?.releaseOwner(owner); }
      if (!terminal.has(session.report.status) && !session.human && !['paused', 'needs_user'].includes(session.report.status)) {
        session.report.controlOwner = 'none'; session.report.controlEpoch!++; this.publish(session);
      }
    }
    return structuredClone(session.report);
  }
  async setExecutionMode(owner: string, executionMode: PhoneExecutionMode, context: ExecutionContext, applyCurrent = false, expectedEpoch?: number): Promise<PhoneReport | undefined> {
    const session = this.sessions.get(owner);
    if (session && expectedEpoch !== undefined && session.report.controlEpoch !== expectedEpoch) throw new PhoneError('PHONE_CONTROL_STALE', 'Phone control changed; refresh before switching', 409);
    if (applyCurrent && session?.report.task) {
      this.guard(session, context);
      if (session.switching) throw new PhoneError('PHONE_SESSION_BUSY', 'Phone execution mode is changing', 409);
      if (session.human || session.report.handoff !== 'idle' || session.report.status === 'needs_user') throw new PhoneError('PHONE_PAUSED', 'Wait for explicit user handback before switching the current task', 409);
      if (session.report.steps.at(-1)?.dispatch === 'unknown' || session.report.status === 'outcome_unknown') throw new PhoneError('PHONE_DISPATCH_UNKNOWN', 'Inspect the previous input before switching', 409);
      session.switching = true;
      try {
        await this.stop(owner, 'pause');
        if (session.report.steps.at(-1)?.dispatch === 'unknown') throw new PhoneError('PHONE_DISPATCH_UNKNOWN', 'Inspect the previous input before switching', 409);
        const observation = await this.observe(session, AbortSignal.timeout(10_000));
        try { this.guard(session, context); this.allowedScreen(session, observation); this.recordObservation(session, observation); }
        finally { observation.frame.fill(0); }
        session.trajectory = []; session.trajectorySummary = []; session.frames.clear();
        session.report.task = { ...session.report.task, executionMode };
        session.report.executionMode = executionMode;
        if (session.report.feedback) session.report.feedback = { ...session.report.feedback, executionMode, segmentId: randomUUID() };
        session.modeHandbackRequired = true;
        session.report.stopReason = 'mode_changed';
        session.report.message = 'Execution mode changed. Inspect and hand back control, then continue the remaining goal with the same taskId.';
      } finally { session.switching = false; }
    }
    this.repository.setExecutionMode(owner, executionMode);
    return session ? this.publish(session) : undefined;
  }
  private busy(deviceId: string, session?: Session): PhoneError {
    const kind = session?.human ? 'human' : session && ['paused', 'needs_user', 'failed', 'outcome_unknown'].includes(session.report.status) ? 'inspection' : session ? 'agent' : 'opening';
    return new PhoneError('PHONE_DEVICE_BUSY', kind === 'human'
      ? 'Phone is under manual control. This task did not start. Hand back control before starting another task.'
      : kind === 'inspection' ? 'Phone requires inspection in the current conversation. This task did not start.'
        : 'Phone is occupied by another task or is connecting. This task did not start. View the phone or wait; do not retry automatically.', 409,
    { executionStarted: false, deviceId, occupancy: { kind, conversationId: session?.report.owner
      ?? [...this.openings].find(([, controller]) => controller === this.deviceOpenings.get(deviceId))?.[0], sessionId: session?.report.sessionId }, retryPolicy: 'user_initiated' });
  }
  private async finishTask(owner: string): Promise<PhoneReport | { status: 'closed' }> {
    const session = this.sessions.get(owner);
    if (!session || terminal.has(session.report.status)) return this.status(owner) ?? { status: 'closed' };
    if (this.deviceOpenings.has(session.device.id)) throw this.busy(session.device.id, session);
    if (session.human || session.report.status === 'needs_user' || session.report.steps.at(-1)?.dispatch === 'unknown') throw this.busy(session.device.id, session);
    if (session.active) await this.stop(owner, 'pause');
    await this.locationEnvironment?.releaseOwner(owner);
    session.controller = new AbortController(); session.report.controlOwner = 'none'; session.report.controlEpoch!++;
    if (session.report.status !== 'completed') session.report.status = 'ready';
    session.report.stopReason = 'task_finished';
    session.taskPending = false; session.adapter.reset?.();
    session.report.goalPreview = undefined;
    session.report.facts = undefined; session.report.readings = undefined; session.report.task = undefined; session.report.feedback = undefined; session.segmentUsage = undefined; session.taskActiveMs = 0; session.taskStart = undefined; session.modeHandbackRequired = false; session.frames.clear();
    await session.stream?.revoke();
    return this.publish(session);
  }
  private async perform(session: Session, input: Exclude<PhoneInput, { op: 'open' | 'discover' }>, context: ExecutionContext, signal: AbortSignal): Promise<PhoneReport> {
    let observation: PhoneObservation | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const startedAt = Date.now();
    session.report.errorCode = undefined; session.report.verified = false; session.report.verificationLevel = 'none';
    session.report.stopReason = undefined; session.report.message = undefined;
    session.report.facts = undefined; session.report.readings = undefined;
    try {
      await this.waitForAgent(session, signal); session.report.status = 'running';
      this.publish(session);
      heartbeat = setInterval(() => { try { this.guard(session, context); } catch (error) { session.controller.abort(error); } }, 10_000);
      heartbeat.unref();
      observation = await this.observe(session, signal);
      this.allowedScreen(session, observation);
      if (input.op === 'observe') {
        this.recordObservation(session, observation);
        if (!session.report.facts?.length || input.goal) {
          await this.readScreen(session, observation, input.goal ?? 'Read the visible page text and values', context, signal);
        }
        if (session.report.controlOwner === 'agent' && !signal.aborted) session.report.status = 'ready';
        return this.publish(session);
      }
      if (input.op !== 'run' && input.op !== 'step') throw new PhoneError('PHONE_INVALID_OPERATION', 'Unsupported operation');
      if (session.report.mode !== 'control') throw new PhoneError('PHONE_OBSERVE_ONLY', 'Reopen the phone in control mode to execute actions');
      if (session.report.mock && input.scenario !== 'settings-about') throw new PhoneError('PHONE_MOCK_SCENARIO_REQUIRED', 'Mock mode only supports the explicit settings-about scenario');
      const maxActions = input.op === 'step' ? 1 : input.maxActions;
      const requiredTexts = [...(input.completion?.textAll ?? []), ...(input.expectText ? [input.expectText] : [])];
      const completion = input.completion || input.expectText ? { ...input.completion, textAll: requiredTexts.length ? requiredTexts : undefined } : undefined;
      let actions = 0;
      let protocolFeedback: string | undefined;
      let repairs = 0;
      let completionCorrections = 0;
      let recoveryHint: string | undefined;
      const enhancements = { semanticControls: context.config.phone.semanticControls,
        hierarchicalPlanning: context.config.phone.hierarchicalPlanning };
      const derivedPlan = enhancements.hierarchicalPlanning ? buildPhonePlan(input.goal, completion) : undefined;
      let planning: PhonePlanState | undefined = derivedPlan ? createPhonePlanState(derivedPlan) : undefined;
      if (enhancements.hierarchicalPlanning) {
        session.report.diagnostics!.plannedSubgoals = planning?.steps.length ?? 0;
        session.report.diagnostics!.completedSubgoals = 0;
      }
      let changed = false;
      const entryObservation = { ...observation, frame: Buffer.alloc(0), elements: structuredClone(observation.elements) };
      const trajectoryStart = session.trajectoryCount;
      let pendingFocus: PhoneFocusRecovery | undefined;
      let numericIntent: PhoneNumericEntryIntent | undefined;
      let numericPending: PhoneNumericEntryStep | undefined;
      const focusedIntents = new Set<string>();
      let backReplans = 0;
      let focusReplans = 0;
      let previousSignature = observationSignature(observation);
      let controlEpoch = session.report.controlEpoch;
      const attempts = new Map<string, number>();
      while (true) {
        if (await this.waitForAgent(session, signal)) { observation.frame.fill(0); observation = await this.observe(session, signal); }
        signal.throwIfAborted(); this.guard(session, context); this.allowedScreen(session, observation);
        const epoch = session.report.controlEpoch;
        if (controlEpoch !== epoch) {
          attempts.clear(); recoveryHint = 'The user handed back control. Re-evaluate the fresh screen before continuing.';
          pendingFocus = undefined; numericIntent = undefined; numericPending = undefined;
          controlEpoch = epoch;
        }
        const signature = observationSignature(observation);
        if (signature !== previousSignature) changed = true;
        previousSignature = signature;
        this.recordObservation(session, observation);
        if (planning) {
          planning = advancePhonePlan(planning, observation);
          session.report.diagnostics!.completedSubgoals = planning.verifiedSteps;
        }
        let numericStep: PhoneNumericEntryStep | undefined;
        if (enhancements.hierarchicalPlanning) {
          numericIntent ??= createPhoneNumericEntry(input.goal, completion, observation);
          if (numericIntent) {
            let next = nextPhoneNumericEntry(numericIntent, observation, numericPending);
            for (let poll = 0; numericPending && next.kind === 'blocked' && poll < 2; poll++) {
              await delay(150, undefined, { signal });
              observation.frame.fill(0); observation = await this.observe(session, signal);
              this.guard(session, context); this.allowedScreen(session, observation);
              if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') break;
              next = nextPhoneNumericEntry(numericIntent, observation, numericPending);
            }
            if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') continue;
            this.recordObservation(session, observation);
            if (next.kind === 'blocked') {
              session.report.diagnostics!.numericMismatches = (session.report.diagnostics!.numericMismatches ?? 0) + 1;
              session.report.status = 'paused'; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
              session.report.stopReason = 'numeric_state_mismatch';
              session.report.message = 'Numeric input was not confirmed. Inspect the displayed value before continuing; no key was retried.';
              session.budget?.pause(); await session.stream?.revoke(); return this.publish(session);
            }
            if (numericPending) session.report.diagnostics!.numericConfirmedSteps = (session.report.diagnostics!.numericConfirmedSteps ?? 0) + 1;
            numericPending = undefined;
            if (next.kind === 'action') numericStep = next.step;
          }
        }
        const satisfied = session.report.mock ? isAboutScreen(observation)
          : Boolean(completion && phoneCompletionSatisfied(completion, observation, changed));
        if (satisfied) {
          const confirmation = await this.observe(session, signal);
          try {
            signal.throwIfAborted(); this.guard(session, context);
            this.allowedScreen(session, confirmation);
            const confirmed = session.report.mock ? isAboutScreen(confirmation)
              : Boolean(completion && phoneCompletionSatisfied(completion, confirmation, changed));
            if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent' || !confirmed) {
              observation.frame.fill(0); observation = confirmation; continue;
            }
            this.recordObservation(session, confirmation);
            if (planning) {
              planning = advancePhonePlan(planning, confirmation);
              session.report.diagnostics!.completedSubgoals = planning.verifiedSteps;
            }
            session.report.verified = true; session.report.verificationLevel = 'ui'; session.report.status = 'completed';
            session.report.stopReason = actions ? 'condition_satisfied' : 'condition_present'; return this.publish(session);
          } finally { if (observation !== confirmation) confirmation.frame.fill(0); }
        }
        if (session.report.actions - (session.report.humanActions ?? 0) - (session.taskStart?.actions ?? 0) >= (session.report.task?.budget?.maxActions ?? 80)) { session.report.status = 'ready'; session.report.stopReason = 'task_action_limit'; return this.publish(session); }
        if (actions >= maxActions) { session.report.status = 'ready'; session.report.stopReason = 'action_limit'; return this.publish(session); }
        let decision: PhoneModelDecision | undefined = numericStep ? { kind: 'action', action: numericStep.action } : undefined;
        let resumedText = false;
        if (!decision && pendingFocus) {
          const pending = pendingFocus; pendingFocus = undefined;
          const intended = confirmPhoneFocusRecovery(pending, observation);
          if (intended) { decision = { kind: 'action', action: intended }; resumedText = true; }
          else recoveryHint = 'The focus transition was not confirmed. No text was sent. Reinspect the intended editable field before another action.';
        }
        if (!decision) {
          if (session.report.modelRequests >= this.modelRequestLimit(session, context)) throw new PhoneError('PHONE_MODEL_LIMIT', 'Phone model request limit reached');
          session.report.modelRequests++; session.report.currentAction = undefined; this.publish(session);
          session.prediction = new AbortController();
          try {
            decision = await session.adapter.predict({ goal: input.goal, task: session.report.task, observation, completion, allowedApps: session.device.allowedApps, appAccess: phoneAppAccess(session.device),
              applications: session.applications.filter(app => phoneAllowsApp(session.device, app.packageName)),
              history: session.report.steps.map(step => step.action), trajectory: session.trajectory,
              progressSummary: JSON.stringify({ dispatched: session.trajectoryCount,
                earlier: [...session.trajectorySummary, ...session.trajectory.slice(0, -8).map(entry => JSON.stringify({ action: entry.action, effect: entry.effect, afterApp: entry.afterApp }).slice(0, 250))].slice(-12) }).slice(-1500),
              recoveryHint: recoveryHint ?? (completion ? phoneCompletionGuidance(completion, observation, changed) : undefined),
              protocolFeedback, scenario: input.scenario, enhancements, planning }, AbortSignal.any([signal, session.prediction.signal]));
          } catch (error) {
            if (!signal.aborted && epoch !== session.report.controlEpoch) {
              await this.waitForAgent(session, signal); observation.frame.fill(0); observation = await this.observe(session, signal); continue;
            }
            if (!signal.aborted && error instanceof PhoneError && ['PHONE_MODEL_PROTOCOL', 'PHONE_MODEL_TRUNCATED', 'PHONE_MODEL_REPETITION'].includes(error.code)
              && repairs < 1 && session.report.modelRequests < this.modelRequestLimit(session, context)) {
              repairs++; session.report.diagnostics!.protocolRepairs++;
              protocolFeedback = 'Your previous output was invalid or truncated. Return exactly one complete action in the specified format with no extra prose.';
              observation.frame.fill(0); observation = await this.observe(session, signal); continue;
            }
            throw error;
          } finally { session.prediction = undefined; }
        }
        signal.throwIfAborted(); this.guard(session, context);
        if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') {
          await this.waitForAgent(session, signal); observation.frame.fill(0); observation = await this.observe(session, signal); continue;
        }
        protocolFeedback = undefined;
        if (enhancements.hierarchicalPlanning && !planning && decision.plan) {
          planning = advancePhonePlan(createPhonePlanState(decision.plan), observation);
          session.report.diagnostics!.plannedSubgoals = planning.steps.length;
          session.report.diagnostics!.completedSubgoals = planning.verifiedSteps;
        }
        if (decision.kind !== 'action') {
          if (decision.kind === 'complete' && !session.report.mock && completion) {
            observation.frame.fill(0); observation = await this.observe(session, signal);
            signal.throwIfAborted(); this.guard(session, context); this.allowedScreen(session, observation);
            if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') continue;
            const currentChanged = changed || observationSignature(observation) !== previousSignature;
            // Late UI updates return to the ordinary independent confirmation path without another prediction.
            if (phoneCompletionSatisfied(completion, observation, currentChanged)) continue;
            this.recordObservation(session, observation);
            if (completionCorrections < PHONE_COMPLETION_CORRECTIONS && session.report.modelRequests < this.modelRequestLimit(session, context)) {
              completionCorrections++; session.report.diagnostics!.completionCorrections++;
              recoveryHint = phoneCompletionRecoveryHint(completion, observation, currentChanged, completionCorrections);
              continue;
            }
            session.report.status = 'paused'; session.report.verified = false; session.report.verificationLevel = 'none';
            session.report.controlOwner = 'none'; session.report.controlEpoch!++;
            session.report.stopReason = 'completion_unmet'; session.report.errorCode = 'PHONE_COMPLETION_UNMET';
            session.report.message = 'The required native UI conditions are still unmet. Inspect the current screen before resuming; no action was generated from the completion conditions.';
            session.budget?.pause(); await session.stream?.revoke(); return this.publish(session);
          }
          session.report.message = decision.kind === 'needsUser' ? decision.reason : decision.summary;
          if (decision.kind === 'complete') {
            this.recordObservation(session, observation);
            if (!context.config.phone.batchReadings || !session.adapter.readFields || !session.report.task?.requestedOutputs.some(request => !request.selector))
              await this.readScreen(session, observation, input.goal, context, signal);
            if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') return this.publish(session);
          }
          session.report.status = decision.kind === 'needsUser' ? 'needs_user' : 'completed';
          session.report.stopReason = decision.kind === 'needsUser' ? 'user_takeover' : 'model_finished_unverified';
          if (decision.kind === 'needsUser' && !session.report.mock) {
            session.report.controlOwner = 'none'; session.report.controlEpoch!++; session.budget?.pause();
            session.report.assistanceId = context.onNeedsUser?.(this.checkpoint(session));
            await session.stream?.revoke();
            return this.publish(session);
          }
          return this.publish(session);
        }
        let preparedFocus: PhoneFocusRecovery | undefined;
        if (enhancements.hierarchicalPlanning) {
          const operationActions = session.trajectoryCount - trajectoryStart;
          const back = phoneBackRecovery({ action: decision.action, observation, entryObservation, completion,
            trajectory: operationActions ? session.trajectory.slice(-operationActions) : [] });
          if (back) {
            session.report.diagnostics!.backReplans = (session.report.diagnostics!.backReplans ?? 0) + 1;
            if (backReplans++ >= 2) {
              session.report.status = 'paused'; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
              session.report.stopReason = 'back_boundary'; session.report.message = back.hint;
              session.budget?.pause(); await session.stream?.revoke(); return this.publish(session);
            }
            recoveryHint = back.hint;
            observation.frame.fill(0); observation = await this.observe(session, signal); continue;
          }
          const focusHint = phoneUnfocusedTypingHint(decision.action, observation, completion);
          if (focusHint) {
            const key = JSON.stringify(decision.action);
            preparedFocus = !focusedIntents.has(key) ? preparePhoneFocusRecovery(decision.action, observation, completion) : undefined;
            if (preparedFocus) decision = { kind: 'action', action: preparedFocus.focusAction };
            else {
              session.report.diagnostics!.focusReplans = (session.report.diagnostics!.focusReplans ?? 0) + 1;
              if (focusReplans++ >= 2) throw new PhoneError('PHONE_INPUT_NOT_FOCUSED', 'The requested editable field could not be focused; inspect before typing', 409);
              recoveryHint = focusHint;
              observation.frame.fill(0); observation = await this.observe(session, signal); continue;
            }
          }
        }
        // Re-observe immediately before input. Layout drift discards the proposed coordinates.
        const fresh = await this.observe(session, signal);
        try {
          this.allowedScreen(session, fresh);
          if (decision.action.type !== 'tapElement' && !canDispatchPhoneAction(decision.action, observation, fresh)) {
            session.report.diagnostics!.stalePredictions++;
            recoveryHint = 'The proposed action was not dispatched because its target changed. Locate it again on the fresh screen.';
            observation.frame.fill(0); observation = fresh; continue;
          }
          let action = enhancements.semanticControls ? groundPhoneCoordinateAction(decision.action, observation) : decision.action;
          const semanticAction = action.type === 'tapElement';
          if (action.type === 'tapElement') {
            if (!enhancements.semanticControls && !preparedFocus) throw new PhoneError('PHONE_SEMANTIC_DISABLED', 'Semantic controls are disabled');
            try { action = resolvePhoneSemanticAction(action, observation, fresh); }
            catch (error) {
              if (!(error instanceof PhoneError) || !error.code.startsWith('PHONE_SEMANTIC_')) throw error;
              session.report.diagnostics!.semanticRejections = (session.report.diagnostics!.semanticRejections ?? 0) + 1;
              recoveryHint = 'The semantic target was not dispatched: select one unique fully visible non-password control from the fresh native UI.';
              observation.frame.fill(0); observation = fresh; continue;
            }
          }
          if (!canDispatchPhoneAction(action, observation, fresh)) {
            session.report.diagnostics!.stalePredictions++;
            recoveryHint = 'The proposed action was not dispatched because its target changed. Locate it again on the fresh screen.';
            observation.frame.fill(0); observation = fresh; continue;
          }
          if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') continue;
          const attemptKey = `${observationSignature(fresh)}:${JSON.stringify(action)}`;
          const repetitions = attempts.get(attemptKey) ?? 0;
          if (repetitions >= (action.type === 'wait' ? 3 : 2)) {
            session.report.status = 'paused'; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
            session.report.stopReason = 'no_progress';
            session.report.message = 'Repeated actions made no progress. Inspect the phone and hand back before continuing.';
            session.budget?.pause(); await session.stream?.revoke(); return this.publish(session);
          }
          attempts.set(attemptKey, repetitions + 1);
          if (await this.dispatch(session, action, fresh, context, signal, epoch)) {
            actions++;
            if (semanticAction && enhancements.semanticControls) session.report.diagnostics!.semanticActions = (session.report.diagnostics!.semanticActions ?? 0) + 1;
            if (preparedFocus) {
              pendingFocus = preparedFocus; focusedIntents.add(JSON.stringify(preparedFocus.intendedAction));
              session.report.diagnostics!.focusRecoveries = (session.report.diagnostics!.focusRecoveries ?? 0) + 1;
            }
            if (resumedText) session.report.diagnostics!.resumedTextInputs = (session.report.diagnostics!.resumedTextInputs ?? 0) + 1;
            if (numericStep) { numericPending = numericStep; session.report.diagnostics!.numericActions = (session.report.diagnostics!.numericActions ?? 0) + 1; }
          }
        } finally { if (observation !== fresh) fresh.frame.fill(0); }
        const beforeSignature = observationSignature(observation);
        observation.frame.fill(0); observation = await this.observe(session, signal);
        const entry = session.trajectory.at(-1);
        if (entry && entry.actor === 'agent' && epoch === session.report.controlEpoch) {
          const unchanged = beforeSignature === observationSignature(observation);
          entry.afterApp = observation.package; entry.effect = unchanged ? 'unchanged' : 'changed';
          entry.facts = phoneTrajectoryFacts(observation);
          if (unchanged) session.report.diagnostics!.unchangedActions++;
          recoveryHint = unchanged
            ? 'The last dispatched action produced no observable change. Wait if loading, otherwise try a different target or route; do not repeat an uncertain input.'
            : undefined;
        }
      }
    } catch (error) {
      const failure = signal.aborted && signal.reason instanceof PhoneError ? signal.reason : error;
      if (!signal.aborted && failure instanceof PhoneError && ['PHONE_TEXT_INPUT_UNAVAILABLE', 'PHONE_TEXT_INPUT_UNCONFIRMED'].includes(failure.code)) {
        session.report.status = 'needs_user'; session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
        session.report.errorCode = failure.code; session.report.message = failure.message;
        session.report.currentAction = undefined;
        session.report.stopReason = failure.code === 'PHONE_TEXT_INPUT_UNAVAILABLE' ? 'text_input_required' : 'text_input_unconfirmed';
        session.budget?.pause();
        session.report.assistanceId = context.onNeedsUser?.(this.checkpoint(session));
        await session.stream?.revoke();
        return this.publish(session);
      }
      if (failure instanceof PhoneError && failure.code === 'PHONE_OPERATION_TIMEOUT'
        && !terminal.has(session.report.status) && session.report.status !== 'paused' && session.report.status !== 'outcome_unknown') {
        session.report.status = 'paused'; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
        session.report.handoff = 'idle'; session.report.errorCode = failure.code;
        session.report.stopReason = 'operation_timeout'; session.report.message = failure.message;
        session.budget?.pause();
        await session.stream?.revoke();
        log.warn({ sessionId: session.report.sessionId, conversationId: session.report.owner,
          durationMs: Date.now() - startedAt, actions: session.report.actions, modelRequests: session.report.modelRequests,
          errorCode: failure.code, phase: 'goal_timeout' }, 'Phone goal timed out; session remains paused for inspection');
        return this.publish(session);
      }
      log.warn({ sessionId: session.report.sessionId, conversationId: session.report.owner,
        durationMs: Date.now() - startedAt, errorCode: failure instanceof PhoneError ? failure.code : signal.aborted ? 'PHONE_CANCELLED' : 'PHONE_OPERATION_FAILED',
        phase: 'goal_failed' }, 'Phone goal stopped before completion');
      if (!['paused', 'cancelled', 'closed'].includes(session.report.status)) {
        if (String(session.report.status) !== 'outcome_unknown') session.report.status = signal.aborted ? 'cancelled' : 'failed';
        session.report.errorCode = failure instanceof PhoneError ? failure.code : signal.aborted ? 'PHONE_CANCELLED' : 'PHONE_OPERATION_FAILED';
        session.report.message = failure instanceof PhoneError ? failure.message : signal.aborted ? 'Phone operation stopped' : 'Phone operation failed; inspect device diagnostics';
        session.report.stopReason = String(session.report.status) === 'outcome_unknown' ? 'inspect_before_retry' : 'operation_failed';
      }
      if (terminal.has(session.report.status)) this.repository.release(session.device.serial, session.lease);
      this.publish(session);
      if (failure instanceof PhoneError) throw failure;
      throw new PhoneError(signal.aborted ? 'PHONE_CANCELLED' : 'PHONE_OPERATION_FAILED', signal.aborted ? 'Phone operation stopped' : 'Phone operation failed; inspect device diagnostics');
    } finally {
      if (heartbeat) clearInterval(heartbeat); observation?.frame.fill(0);
      log.info({ sessionId: session.report.sessionId, conversationId: session.report.owner, phase: 'goal_end',
        durationMs: Date.now() - startedAt, status: session.report.status, stopReason: session.report.stopReason,
        actions: session.report.actions, modelRequests: session.report.modelRequests, diagnostics: session.report.diagnostics }, 'Phone goal finished');
    }
  }
  private recordObservation(session: Session, observation: PhoneObservation): void {
    if (session.report.task && session.report.feedback) session.report.feedback.outputs = session.report.task.requestedOutputs.map(output => nativePhoneOutput(output, observation));
    session.report.foregroundApp = observation.package;
    session.report.facts = [...new Set(observation.elements.flatMap(node => node.password ? [] : [node.text, node.description]).filter(Boolean))].slice(0, 60);
    session.report.readings = [{ source: 'native_ui', verification: 'observed', text: session.report.facts,
      frameId: observation.frameId, capturedAt: observation.capturedAt }];
  }
  private modelRequestLimit(session: Session, context: ExecutionContext): number {
    return Math.min(context.config.phone.maxModelRequests, (session.taskStart?.modelRequests ?? 0) + (session.report.task?.budget?.maxModelRequests ?? 120));
  }
  private async readOutputFields(session: Session, observation: PhoneObservation, fields: import('./contracts.js').PhoneRequestedOutput[], context: ExecutionContext, signal: AbortSignal): Promise<void> {
    const epoch = session.report.controlEpoch;
    let reason: string | undefined;
    let values: Record<string, string | null> | undefined;
    this.guard(session, context); this.allowedScreen(session, observation); signal.throwIfAborted();
    if (observation.elements.some(node => node.password)) reason = 'password_field_visible';
    else if (session.report.modelRequests >= this.modelRequestLimit(session, context)) reason = 'model_request_limit';
    else {
      session.report.modelRequests++; session.prediction = new AbortController();
      try {
        values = await measurePhonePhase('screen_reading', () => session.adapter.readFields!({ goal: session.report.task!.goal,
          observation, allowedApps: session.device.allowedApps, appAccess: phoneAppAccess(session.device), history: [] }, fields,
        AbortSignal.any([signal, session.prediction.signal])));
      } catch (error) {
        signal.throwIfAborted();
        reason = error instanceof PhoneError ? error.code : 'screen_reading_failed';
      } finally { session.prediction = undefined; }
    }
    signal.throwIfAborted(); this.guard(session, context); this.allowedScreen(session, observation);
    if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') return;
    for (const field of fields) {
      const raw = values?.[field.key];
      const value = raw?.trim() ? raw : undefined;
      const output = session.report.feedback!.outputs.find(output => output.key === field.key)!;
      Object.assign(output, { value: value || undefined, source: 'screenshot', verification: value ? 'unverified' : 'unavailable',
        frameId: observation.frameId, capturedAt: observation.capturedAt, reason: value ? undefined : reason ?? 'screen_unreadable' });
      if (value) session.report.readings!.push({ source: 'screenshot', verification: 'unverified', text: [value],
        frameId: observation.frameId, capturedAt: observation.capturedAt });
    }
  }
  private async readScreen(session: Session, observation: PhoneObservation, goal: string, context: ExecutionContext, signal: AbortSignal): Promise<void> {
    if (session.report.mock) return;
    const reading: NonNullable<PhoneReport['readings']>[number] = { source: 'screenshot', verification: 'unavailable', text: [],
      frameId: observation.frameId, capturedAt: observation.capturedAt };
    const epoch = session.report.controlEpoch;
    this.guard(session, context); this.allowedScreen(session, observation); signal.throwIfAborted();
    if (observation.elements.some(node => node.password)) reading.reason = 'password_field_visible';
    else if (!session.adapter.readScreen) reading.reason = 'model_reading_unavailable';
    else if (session.report.modelRequests >= this.modelRequestLimit(session, context)) reading.reason = 'model_request_limit';
    else {
      session.report.modelRequests++;
      session.prediction = new AbortController();
      try {
        const text = await measurePhonePhase('screen_reading', () => session.adapter.readScreen!({ goal, observation, allowedApps: session.device.allowedApps,
          appAccess: phoneAppAccess(session.device), history: [] }, AbortSignal.any([signal, session.prediction.signal])));
        signal.throwIfAborted(); this.guard(session, context); this.allowedScreen(session, observation);
        if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') return;
        if (text.trim()) { reading.text = [text.slice(0, 1000)]; reading.verification = 'unverified'; }
        else reading.reason = 'screen_unreadable';
      } catch (error) {
        signal.throwIfAborted(); this.guard(session, context);
        if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') return;
        reading.reason = error instanceof PhoneError ? error.code : 'screen_reading_failed';
      } finally { session.prediction = undefined; }
    }
    session.report.readings = [...(session.report.readings ?? []), reading];
  }
  private async dispatch(session: Session, action: PhoneAction, observation: PhoneObservation, context: ExecutionContext, signal: AbortSignal, epoch = session.report.controlEpoch, resetTask = false, settingsPage?: 'about-phone'): Promise<boolean> {
    return this.io(session, async () => {
      if (session.human) session.authorizeHuman?.();
      signal.throwIfAborted(); this.guard(session, context, !session.human);
      if (epoch !== session.report.controlEpoch || session.report.controlOwner === 'none' || session.report.handoff !== 'idle') return false;
      if (session.human && Date.now() > (session.humanExpiresAt ?? 0)) throw new PhoneError('PHONE_CONTROL_REQUIRED', 'Manual control expired', 409);
      if (!session.human && session.report.actions - (session.report.humanActions ?? 0) >= context.config.phone.maxActionsPerSession) throw new PhoneError('PHONE_ACTION_LIMIT', 'Phone action limit reached');
      if (session.human && (session.report.humanActions ?? 0) >= 1200) throw new PhoneError('PHONE_ACTION_LIMIT', 'Manual input limit reached; reopen the session');
      if (action.type === 'launch' && !phoneAllowsApp(session.device, action.package)) throw new PhoneError('PHONE_APP_DENIED', 'Application is not authorized');
      if (action.type === 'home' && phoneAppAccess(session.device) !== 'all') throw new PhoneError('PHONE_APP_DENIED', 'Home leaves the app allowlist');
      if (action.type === 'typeText' && session.device.textInput === 'manual')
        throw new PhoneError('PHONE_TEXT_INPUT_UNAVAILABLE', 'Automatic text input is disabled for this phone. Ask the user to take over and type with the phone keyboard.', 409);
      if (action.type === 'typeText' && !observation.elements.some(node => node.focused && node.editable && !node.password))
        throw new PhoneError('PHONE_INPUT_NOT_FOCUSED', 'Focus a non-password editable field before typing', 409);
      const step: PhoneReport['steps'][number] = { action: action.type, at: Date.now(), dispatch: 'unknown', actor: session.human ? 'human' : 'agent' };
      session.report.currentAction = action.type;
      session.report.steps.push(step); session.report.actions++;
      if (session.human) { session.report.humanActions = (session.report.humanActions ?? 0) + 1; session.report.steps = session.report.steps.slice(-200); }
      this.publish(session);
      const entry: PhoneTrajectoryEntry = { action: structuredClone(action), dispatch: 'unknown', actor: step.actor, beforeApp: observation.package, beforeFacts: phoneTrajectoryFacts(observation), effect: 'unknown' };
      session.trajectory.push(entry); session.trajectoryCount++;
      if (session.trajectory.length > 24) {
        const earlier = session.trajectory.shift()!;
        session.trajectorySummary.push(JSON.stringify({ action: earlier.action, effect: earlier.effect, afterApp: earlier.afterApp }).slice(0, 250));
        session.trajectorySummary = session.trajectorySummary.slice(-12);
      }
      try { await measurePhonePhase('dispatch', () => session.driver.execute(session.device.serial, action, observation, signal, settingsPage ? { settleMs: session.human ? 0 : 350, settingsPage } : session.human ? { settleMs: 0, ...(resetTask ? { resetTask: true } : {}) } : undefined)); step.dispatch = 'completed'; entry.dispatch = 'completed'; session.adapter.recordAction?.(action, entry.actor === 'human' ? 'human' : 'completed'); }
      catch (error) {
        session.adapter.reset?.();
        const textFailure = error instanceof PhoneError && ['PHONE_TEXT_INPUT_UNAVAILABLE', 'PHONE_TEXT_INPUT_UNCONFIRMED'].includes(error.code);
        if (textFailure && error.code === 'PHONE_TEXT_INPUT_UNAVAILABLE') {
          session.report.steps.pop(); session.report.actions--; session.trajectory.pop(); session.trajectoryCount--; if (session.human) session.report.humanActions!--;
        } else session.report.status = 'outcome_unknown';
        if (textFailure && session.human) {
          session.report.status = 'paused'; session.report.errorCode = error.code; session.report.message = error.message;
          session.report.stopReason = error.code === 'PHONE_TEXT_INPUT_UNAVAILABLE' ? 'text_input_required' : 'text_input_unconfirmed';
          session.report.currentAction = undefined; this.publish(session);
        }
        session.frames.clear(); throw error;
      }
      signal.throwIfAborted(); this.publish(session);
      return true;
    });
  }
  async stop(owner: string, op: 'pause' | 'cancel' | 'close'): Promise<PhoneReport | { status: 'closed' }> {
    this.openings.get(owner)?.abort();
    const session = this.sessions.get(owner);
    if (!session) return { status: 'closed' };
    session.adapter.reset?.();
    session.controller.abort(); session.prediction?.abort(); session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
    if (op === 'pause') await session.stream?.revoke();
    else { session.videoGeneration = undefined; await session.stream?.close(); session.stream = undefined; }
    for (const wake of session.wake) wake();
    session.report.status = op === 'pause' ? 'paused' : op === 'cancel' ? 'cancelled' : 'closed';
    session.report.stopReason = op; if (op !== 'close') session.report.verified = false;
    if (op !== 'pause') {
      session.report.facts = undefined; session.report.message = undefined; session.report.readings = undefined; session.trajectory = []; session.trajectorySummary = []; session.frames.clear();
      if (op === 'close') session.adapter = { predict: async () => { throw new PhoneError('PHONE_OPEN_REQUIRED', 'Reopen the phone session'); } };
    }
    this.publish(session);
    // Await driver cleanup so resume cannot overlap the previous operation.
    await session.active?.catch(() => {});
    await session.io.catch(() => {});
    await this.releaseInput(session);
    session.adapter.reset?.();
    if (op === 'close') this.repository.release(session.device.serial, session.lease);
    if (op !== 'pause') await this.locationEnvironment?.releaseOwner(owner);
    if (op === 'cancel') {
      session.controller = new AbortController(); session.report.status = 'ready'; session.report.controlOwner = 'none';
      session.taskPending = false;
      if (session.report.steps.at(-1)?.dispatch === 'unknown') { session.report.status = 'outcome_unknown'; session.report.stopReason = 'inspect_before_retry'; }
    }
    return this.publish(session);
  }
  private async releaseInput(session: Session): Promise<void> {
    await session.driver.releaseInput?.().catch(() => log.warn({ conversationId: session.report.owner, phase: 'input_cleanup' }, 'Phone input cleanup failed'));
  }
  private async io<T>(session: Session, work: () => Promise<T>): Promise<T> {
    const operation = session.io.catch(() => {}).then(async () => {
      session.ioBusy = true;
      try { return await work(); } finally { session.ioBusy = false; }
    });
    session.io = operation.catch(() => {});
    return operation;
  }
  private async observe(session: Session, signal: AbortSignal, forText = false): Promise<PhoneObservation> {
    return this.io(session, async () => {
      signal.throwIfAborted();
      const observe = forText && session.driver.observeForText ? session.driver.observeForText : session.driver.observe;
      const observation = await measurePhonePhase<PhoneObservation>('observation', () => observe.call(session.driver, session.device.serial, signal));
      if (phoneAllowsApp(session.device, observation.package)) {
        if (Date.now() - session.viewedAt < 30_000 && !terminal.has(session.report.status)) session.frames.set(observation);
      } else session.frames.clear();
      return observation;
    });
  }
  private async capture(session: Session, signal: AbortSignal): Promise<PhoneObservation> {
    return this.io(session, async () => {
      signal.throwIfAborted(); this.guard(session, session.context, false);
      const observation = await (session.driver.capture ?? session.driver.observe).call(session.driver, session.device.serial, signal);
      try {
        this.guard(session, session.context, false); this.allowedScreen(session, observation);
        if (!terminal.has(session.report.status)) session.frames.set(observation);
        return observation;
      } catch (error) { observation.frame.fill(0); session.frames.clear(); throw error; }
    });
  }
  private async waitForAgent(session: Session, signal: AbortSignal): Promise<boolean> {
    let waited = false;
    while (session.report.controlOwner !== 'agent') {
      waited = true; signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { session.wake.delete(done); signal.removeEventListener('abort', aborted); };
        const done = () => { cleanup(); resolve(); };
        const aborted = () => { cleanup(); reject(signal.reason); };
        session.wake.add(done); signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
    }
    signal.throwIfAborted(); if (waited) session.adapter.reset?.(); return waited;
  }
  private startMaintenance(): void {
    if (this.maintenance) return;
    this.maintenance = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (terminal.has(session.report.status)) { session.frames.clear(); const stream = session.stream; session.stream = undefined; void stream?.close(); continue; }
        try {
          this.guard(session, session.context, false);
          const idleLimit = session.context.config.phone.idleDisconnectMs;
          if (idleLimit && !session.active && !session.human && session.report.controlOwner === 'none'
            && Date.now() - Math.max(session.viewedAt, session.report.updatedAt) >= idleLimit) {
            void this.stopDevice(session.device.id); continue;
          }
          if (session.human && Date.now() > (session.humanExpiresAt ?? 0)) {
            void this.expireHuman(session).catch(() => this.stop(session.report.owner, 'cancel'));
          }
          if (Date.now() - session.viewedAt > 30_000) session.frames.clear();
        } catch { session.frames.clear(); void this.stopDevice(session.device.id); }
      }
    }, 3000);
    this.maintenance.unref();
  }
  private liveSession(owner: string, id: string, context: ExecutionContext): Session {
    const session = this.sessions.get(owner);
    if (!session || session.report.sessionId !== id) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone session not found', 404);
    if (context.agentId !== session.report.agentId) throw new PhoneError('PHONE_ACCESS_CHANGED', 'Agent binding changed', 403);
    if (!terminal.has(session.report.status)) {
      try { this.guard(session, context, false); } catch (error) { session.frames.clear(); throw error; }
    }
    session.context = context; this.startMaintenance();
    return session;
  }
  liveStatus(owner: string, id: string, context: ExecutionContext, client: string) {
    const session = this.liveSession(owner, id, context);
    return { report: { ...structuredClone(session.report), nextExecutionMode: this.repository.executionMode(owner) ?? context.config.phone.executionMode }, ownControl: Boolean(session.human === client), allowedApps: [...session.device.allowedApps], appAccess: phoneAppAccess(session.device), textInput: session.device.textInput ?? 'auto',
      frame: session.frames.get() ? { seq: session.frames.get()!.seq, capturedAt: session.frames.get()!.capturedAt } : null };
  }
  async liveVideo(owner: string, id: string, context: ExecutionContext) {
    const session = this.liveSession(owner, id, context);
    if (terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409);
    if (session.streamOpening) return session.streamOpening;
    const opening = this.openLiveVideo(session);
    session.streamOpening = opening;
    try { return await opening; }
    finally { if (session.streamOpening === opening) session.streamOpening = undefined; }
  }
  private async openLiveVideo(session: Session): Promise<PhoneInteractiveSession> {
    if (!session.stream) {
      // Opening an app publishes its report before the launch dispatch finishes.
      await session.io;
      if (terminal.has(session.report.status)) throw new PhoneError('PHONE_VIDEO_ENDED', 'Phone session ended', 409);
      const generation = Symbol(); session.videoGeneration = generation;
      const failed = () => {
        if (session.videoGeneration !== generation || ![...this.sessions.values()].includes(session)) return;
        session.videoGeneration = undefined;
        void this.stop(session.report.owner, 'pause');
      };
      const provider = session.device.connection
        ? await this.cloud.interactive(session.device, failed)
        : this.interactiveFactory(session.adbPath, session.device.serial, failed);
      if (terminal.has(session.report.status)) {
        await provider.close();
        throw new PhoneError('PHONE_VIDEO_ENDED', 'Phone session ended', 409);
      }
      session.stream = new PhoneInteractiveSession(provider,
        async () => {
          if (terminal.has(session.report.status)) throw new PhoneError('PHONE_VIDEO_ENDED', 'Phone session ended', 409);
          this.guard(session, session.context, false);
          const app = await provider.foreground(AbortSignal.timeout(2000));
          if (!phoneAllowsApp(session.device, app)) throw new PhoneError('PHONE_APP_DENIED', 'Current page is outside the authorized applications', 403);
          session.viewedAt = Date.now();
        }, (client, epoch) => {
          session.authorizeHuman?.();
          if (terminal.has(session.report.status) || session.report.handoff !== 'idle' || session.report.controlOwner !== 'human'
            || session.human !== client || session.report.controlEpoch !== epoch || Date.now() > (session.humanExpiresAt ?? 0)) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Manual control is no longer available', 409);
          session.humanExpiresAt = Date.now() + 15_000;
          if ((session.report.humanActions ?? 0) >= 1200) throw new PhoneError('PHONE_ACTION_LIMIT', 'Manual input limit reached; reopen the session');
        }, action => {
          session.report.actions++; session.report.humanActions = (session.report.humanActions ?? 0) + 1;
          session.report.steps.push({ action, at: Date.now(), actor: 'human', dispatch: 'completed' });
          session.report.steps = session.report.steps.slice(-200); this.publish(session);
        });
    }
    const stream = session.stream;
    try { await stream.start(); return stream; }
    catch (error) { await stream.close(); if (session.stream === stream) session.stream = undefined; throw error; }
  }
  async disconnectVideo(owner: string, id: string, _client: string, _epoch?: number): Promise<void> {
    const session = this.sessions.get(owner);
    if (!session || session.report.sessionId !== id) return;
    // Media loss is independent of the control lease. Explicit release or lease
    // expiry handles control; a late socket close must never revoke a new owner.
    if (session.stream?.viewerCount === 0) { const stream = session.stream; session.stream = undefined; await stream.close(); }
  }
  private async clearExpiredHuman(session: Session): Promise<void> {
    if (!session.human || Date.now() <= (session.humanExpiresAt ?? 0)) return;
    session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
    session.report.status = 'paused'; session.report.stopReason = 'control_disconnected';
    session.report.handoff = 'acquiring'; this.publish(session);
    try { await session.stream?.revoke(); await this.releaseInput(session); }
    catch (error) { await this.stop(session.report.owner, 'cancel'); throw error; }
    finally { session.report.handoff = 'idle'; this.publish(session); }
  }
  private expireHuman(session: Session): Promise<void> {
    const work = session.commands.catch(() => {}).then(() => this.clearExpiredHuman(session));
    session.commands = work.catch(() => {});
    return work;
  }
  async liveFrame(owner: string, id: string, context: ExecutionContext, signal: AbortSignal) {
    const session = this.liveSession(owner, id, context);
    if (terminal.has(session.report.status)) { session.frames.clear(); throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409); }
    session.viewedAt = Date.now();
    if (!session.frames.get() || Date.now() - session.frames.get()!.capturedAt > (session.human ? 150 : 600)) {
      session.preview ??= (async () => {
        const observation = await this.capture(session, signal);
        try { this.guard(session, context, false); this.allowedScreen(session, observation); }
        catch (error) { session.frames.clear(); throw error; }
        finally { observation.frame.fill(0); }
      })().finally(() => { session.preview = undefined; });
      await session.preview;
    }
    this.guard(session, context, false);
    const frame = session.frames.get();
    if (!frame) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409);
    return { ...frame, frame: Buffer.from(frame.frame) };
  }
  async liveControl(owner: string, id: string, context: ExecutionContext, client: string, input: {
    op: 'takeover' | 'release' | 'handback' | 'pause' | 'cancel' | 'heartbeat' | 'input' | 'recover';
    epoch: number; operationId: string; frameSeq?: number; geometry?: number; action?: PhoneAction;
  }, authorize?: () => void): Promise<unknown> {
    authorize?.();
    const session = this.liveSession(owner, id, context);
    if (session.switching) throw new PhoneError('PHONE_SESSION_BUSY', 'Phone execution mode is changing', 409);
    if (this.deviceOpenings.has(session.device.id)) throw this.busy(session.device.id, session);
    // Keep the lease alive while a slow native observation occupies the command queue.
    if (input.op === 'heartbeat') {
      if (terminal.has(session.report.status) || input.epoch !== session.report.controlEpoch
        || session.human !== client || Date.now() > (session.humanExpiresAt ?? 0))
        throw new PhoneError('PHONE_CONTROL_REQUIRED', 'Manual control is no longer available', 409);
      session.humanExpiresAt = Date.now() + 15_000;
      return this.liveStatus(owner, id, context, client);
    }
    const key = `${client}:${input.operationId}`;
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const receipt = session.receipts.get(key);
    if (receipt) {
      if (receipt.hash !== hash) throw new PhoneError('PHONE_DUPLICATE_OPERATION', 'Operation ID was reused with different input', 409);
      return receipt.result;
    }
    if (session.receipts.size >= 240 && !['cancel', 'release', 'heartbeat'].includes(input.op)) throw new PhoneError('PHONE_SESSION_LIMIT', 'Phone control request limit reached; reopen the session');
    const result = session.commands.catch(() => {}).then(async () => {
      authorize?.();
      if (terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409);
      this.guard(session, context, input.op === 'handback');
      if (session.switching) throw new PhoneError('PHONE_SESSION_BUSY', 'Phone execution mode is changing', 409);
      await this.clearExpiredHuman(session);
      if (input.epoch !== session.report.controlEpoch) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Control changed. Refresh before trying again.', 409);
      if (session.human && session.human !== client) throw new PhoneError('PHONE_CONTROL_BUSY', 'Another browser window controls this phone', 409);
      if (input.op === 'cancel') { await this.stop(owner, 'cancel'); return this.liveStatus(owner, id, context, client); }
      if (input.op === 'takeover' || input.op === 'pause') {
        session.adapter.reset?.();
        if (input.op === 'takeover' && session.report.mode !== 'control') throw new PhoneError('PHONE_OBSERVE_ONLY', 'This phone session only allows observation', 403);
        session.report.controlOwner = 'none'; session.report.controlEpoch!++; session.report.handoff = 'acquiring';
        session.report.status = 'paused'; session.budget?.pause(); session.prediction?.abort(); this.publish(session);
        await session.stream?.revoke();
        await session.io;
        await this.releaseInput(session);
        if (terminal.has(session.report.status) || session.report.steps.at(-1)?.dispatch === 'unknown') {
          session.report.handoff = 'idle'; this.publish(session);
          throw new PhoneError('PHONE_DISPATCH_UNKNOWN', 'Inspect the phone before taking control; previous input is unresolved', 409);
        }
        if (session.controller.signal.aborted && !session.active) session.controller = new AbortController();
        session.human = undefined;
        if (input.op === 'takeover') { authorize?.(); session.authorizeHuman = authorize; session.human = client; session.humanExpiresAt = Date.now() + 15_000; session.report.controlOwner = 'human'; }
        session.report.handoff = 'idle'; this.publish(session);
      } else if (input.op === 'release') {
        if (session.human !== client) throw new PhoneError('PHONE_CONTROL_REQUIRED', 'This browser does not control the phone', 409);
        session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
        await session.stream?.revoke();
        await this.releaseInput(session);
        session.report.status = 'paused'; session.report.stopReason = 'user_paused'; this.publish(session);
      } else if (input.op === 'handback') {
        if (session.report.controlOwner === 'agent') throw new PhoneError('PHONE_NOT_PAUSED', 'The Agent already controls this phone', 409);
        // Tool pause aborts its controller after draining the previous operation.
        if (session.controller.signal.aborted && !session.active) session.controller = new AbortController();
        session.report.handoff = 'returning'; session.report.controlEpoch!++; session.human = undefined;
        session.report.controlOwner = 'none'; this.publish(session);
        await session.stream?.revoke(); await this.releaseInput(session);
        let observation: PhoneObservation | undefined;
        try {
          observation = await this.observe(session, session.controller.signal);
          if (terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended during handback', 409);
          this.guard(session, context); this.allowedScreen(session, observation); this.recordObservation(session, observation);
        } catch (error) {
          session.frames.clear(); session.report.handoff = 'idle';
          if (!terminal.has(session.report.status)) session.report.status = 'paused';
          this.publish(session); throw error;
        } finally { observation?.frame.fill(0); }
        authorize?.();
        session.report.controlOwner = session.active || session.taskPending ? 'agent' : 'none'; session.report.status = session.active ? 'running' : 'ready';
        session.report.handoff = 'idle'; session.modeHandbackRequired = false; session.report.message = undefined; session.report.stopReason = undefined;
        session.budget?.resume(); this.publish(session); for (const wake of session.wake) wake();
      } else if (input.op === 'recover') {
        if (session.human !== client || Date.now() > (session.humanExpiresAt ?? 0)) throw new PhoneError('PHONE_CONTROL_REQUIRED', 'Take over the phone first', 409);
        if (input.action?.type !== 'launch' || !phoneAllowsApp(session.device, input.action.package)) throw new PhoneError('PHONE_APP_DENIED', 'Choose an authorized recovery application', 403);
        // Inspect only for launch execution; never publish pixels from a refused application.
        const observation = await this.io(session, () => session.driver.capture ? session.driver.capture(session.device.serial, session.controller.signal) : session.driver.observe(session.device.serial, session.controller.signal));
        try {
          if (!await this.dispatch(session, input.action, observation, context, session.controller.signal, input.epoch, true)) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Control changed before recovery', 409);
          session.humanExpiresAt = Date.now() + 15_000;
        } finally { observation.frame.fill(0); session.frames.clear(); }
        this.publish(session);
      } else if (input.op === 'input') {
        if (session.human !== client || Date.now() > (session.humanExpiresAt ?? 0)) throw new PhoneError('PHONE_CONTROL_REQUIRED', 'Take over the phone first', 409);
        const frame = session.frames.metadata(input.frameSeq);
        const video = input.geometry !== undefined && session.stream?.verifyGeometry(input.geometry);
        if (!video && (!frame || Date.now() - frame.capturedAt > 5000)) throw new PhoneError('PHONE_FRAME_STALE', 'Wait for a fresh phone image before interacting', 409);
        if (video && input.action?.type !== 'typeText' && input.action?.type !== 'back') throw new PhoneError('PHONE_INVALID_INPUT', 'Use the continuous input channel for video gestures', 409);
        if (!input.action || input.action.type === 'launch' || input.action.type === 'home' || input.action.type === 'wait' || input.action.type === 'tapElement') throw new PhoneError('PHONE_INVALID_INPUT', 'Unsupported manual input');
        const observation = input.action.type === 'typeText' ? await this.observe(session, session.controller.signal, true) : await this.capture(session, session.controller.signal);
        try {
          if (input.epoch !== session.report.controlEpoch || session.human !== client || Date.now() > (session.humanExpiresAt ?? 0)) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Manual control expired while observing the phone', 409);
          this.allowedScreen(session, observation);
          if (frame && !video && (observation.width !== frame.width || observation.height !== frame.height || observation.rotation !== frame.rotation || observation.package !== frame.package)) throw new PhoneError('PHONE_FRAME_STALE', 'Phone orientation or application changed; retry on the new image', 409);
          if (!await this.dispatch(session, input.action, observation, context, session.controller.signal, input.epoch)) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Control changed before input dispatch', 409);
          session.humanExpiresAt = Date.now() + 15_000;
        } finally { observation.frame.fill(0); }
        // Force the next viewer request to capture the post-input screen without delaying the input acknowledgement.
        session.frames.invalidate();
        this.publish(session);
      }
      return { ...this.liveStatus(owner, id, context, client), resumeTurnRequired: input.op === 'handback' && !session.active && Boolean(session.taskPending) };
    });
    session.commands = result.catch(() => {
      if (terminal.has(session.report.status)) {
        session.frames.clear(); this.repository.release(session.device.serial, session.lease);
        session.controller.abort(); for (const wake of session.wake) wake(); this.publish(session);
      }
    }); session.receipts.set(key, { hash, result });
    return result;
  }
  /** Called only for an explicit completion message from the controlling conversation's user. */
  async completeAssistanceForUser(owner: string, context: ExecutionContext): Promise<void> {
    const session = this.sessions.get(owner);
    if (!session) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Reconnect the phone before continuing', 409);
    this.guard(session, context);
    if (session.report.controlOwner === 'agent' && session.report.status === 'ready') return;
    if (session.human) throw new PhoneError('PHONE_CONTROL_BUSY', 'Another client is operating the phone. End manual control before continuing.', 409);
    await this.liveControl(owner, session.report.sessionId, context, `phone-user:${owner}`,
      { op: 'handback', epoch: session.report.controlEpoch!, operationId: randomUUID() });
  }
  async stopDevice(id: string): Promise<void> { this.deviceOpenings.get(id)?.abort(); await Promise.all(this.reports().filter(report => report.deviceId === id).map(report => this.stop(report.owner, 'close'))); try { await this.locationEnvironment?.releaseDevice(id); } finally { this.cloudPhones?.disconnect(id); } }
  async shutdown(): Promise<void> {
    this.wireless.close(); this.reconnectAfter.clear();
    await Promise.allSettled(this.reconnecting.values());
    for (const controller of this.openings.values()) controller.abort(); await Promise.all([...this.sessions.keys()].map(owner => this.stop(owner, 'close'))); await this.locationEnvironment?.close(); this.cloudPhones?.close(); this.sessions.clear(); this.lastDevices.clear(); if (this.maintenance) clearInterval(this.maintenance); this.maintenance = undefined; }
}

let runtime: PhoneRuntime | undefined;
export function getPhoneRuntime(): PhoneRuntime { return runtime ??= new PhoneRuntime(); }
export function phoneExecutionContext(config: Config, agentId: string): ExecutionContext {
  const agent = resolveEffectiveAgentConfigForAgent(agentId).config;
  const denied = (value: typeof agent) => value.tools.phone_use?.mode === 'deny' || Boolean(value.toolAllowlist && !value.toolAllowlist.includes('phone_use'));
  return { config, agentId, modelRef: agent.models.phoneUse?.primary, toolDenied: denied(agent), validateBinding: () => {
    const current = resolveEffectiveAgentConfigForAgent(agentId).config;
    return current.models.phoneUse?.primary === agent.models.phoneUse?.primary && !denied(current);
  } };
}
