import { createHash, randomUUID } from 'node:crypto';
import { phoneAllowsApp, phoneAppAccess } from './app-access.js';
import { PhoneFrameCache, PhoneOperationBudget } from './live-state.js';
import { PhoneInteractiveSession } from './interactive-session.js';
import { LocalScrcpyProvider } from './scrcpy.js';
import type { PhoneInteractiveProvider } from './live-provider.js';

import { createLogger } from '../utils/logger.js';

import type { Config } from '../config/schema.js';
import { resolveEffectiveAgentConfigForAgent } from '../config/agent-profile.js';
import { CloudPhones } from './cloud-phones.js';
import { AdbPhoneDriver, resolveAdbPath, type PhoneDriver } from './adb-driver.js';
import { createPhoneModel, isAboutScreen, type PhoneModelAdapter, type PhoneTrajectoryEntry } from './model-adapter.js';
import { PhoneRepository } from './repository.js';
import { canDispatchPhoneAction, observationSignature, phoneCompletionSatisfied } from './reliability.js';
import {
  MOCK_PHONE_MODEL, PhoneError, PhoneInputSchema, type PhoneAction, type PhoneDevice, type PhoneInput,
  type PhoneApplication, type PhoneObservation, type PhoneReport,
} from './contracts.js';

type ExecutionContext = { config: Config; agentId: string; modelRef?: string; toolDenied?: boolean; validateBinding?: () => boolean };
type Session = {
  report: PhoneReport; device: PhoneDevice; lease: string; driver: PhoneDriver; adapter: PhoneModelAdapter;
  controller: AbortController; active?: Promise<unknown>; createdAt: number; modelRef: string; adbPath: string;
  context: ExecutionContext; frames: PhoneFrameCache; io: Promise<unknown>; ioBusy: boolean;
  prediction?: AbortController; budget?: PhoneOperationBudget; wake: Set<() => void>;
  human?: string; humanExpiresAt?: number; viewedAt: number; preview?: Promise<void>;
  commands: Promise<unknown>; receipts: Map<string, { hash: string; result: Promise<unknown> }>;
  applications: PhoneApplication[];
  trajectory: PhoneTrajectoryEntry[];
  trajectoryCount: number;
  trajectorySummary: string[];
  stream?: PhoneInteractiveSession;
  streamOpening?: Promise<PhoneInteractiveSession>;

};
const log = createLogger('PhoneRuntime');
const terminal = new Set(['cancelled', 'closed', 'failed', 'outcome_unknown']);

export class PhoneRuntime {
  private cloudPhones?: CloudPhones;
  get cloud(): CloudPhones { return this.cloudPhones ??= new CloudPhones(this.repository); }
  private sessions = new Map<string, Session>();
  private openings = new Map<string, AbortController>();
  private maintenance?: ReturnType<typeof setInterval>;
  constructor(
    readonly repository = new PhoneRepository(),
    private driverFactory: (path: string) => PhoneDriver = path => new AdbPhoneDriver(path),
    private modelFactory = createPhoneModel,
    private interactiveFactory: (adb: string, serial: string, failed: () => void) => PhoneInteractiveProvider = (adb, serial, failed) => new LocalScrcpyProvider(adb, serial, failed),
  ) {}

  async driverFor(device: PhoneDevice, config: Config): Promise<PhoneDriver> {
    return device.connection ? this.cloud.driver(device) : this.driverFactory(resolveAdbPath(config.phone.adbPath));
  }
  async discover(config: Config, signal?: AbortSignal) { return this.driverFactory(resolveAdbPath(config.phone.adbPath)).discover(signal); }
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
    const lease = this.repository.acquire(device.serial);
    try {
      const observation = await (await this.driverFor(device, config)).observe(device.serial, signal);
      if (!phoneAllowsApp(device, observation.package)) { observation.frame.fill(0); throw new PhoneError('PHONE_APP_DENIED', 'Open an allowed app before previewing the screen'); }
      return observation;
    } finally { this.repository.release(device.serial, lease); }
  }
  async previewSession(owner: string, context: ExecutionContext, signal: AbortSignal): Promise<PhoneObservation> {
    const session = this.sessions.get(owner);
    if (!session || terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Open a phone session first');
    if (session.active) throw new PhoneError('PHONE_SESSION_BUSY', 'Pause the task before previewing', 409);
    this.guard(session, context);
    const observation = await this.observe(session, signal);
    try { this.allowedScreen(session, observation); return observation; }
    catch (error) { observation.frame.fill(0); throw error; }
  }
  reports(): PhoneReport[] {
    return [...this.sessions.values()].map(session => structuredClone(session.report));
  }
  status(owner: string): PhoneReport | undefined { const report = this.sessions.get(owner)?.report; return report && structuredClone(report); }
  private publish(session: Session): PhoneReport {
    session.report.updatedAt = Date.now();
    this.repository.report(session.report);
    return structuredClone(session.report);
  }
  private guard(session: Session, context: ExecutionContext): void {
    if (!context.config.phone.enabled || context.toolDenied) throw new PhoneError('PHONE_DISABLED', 'Phone Use is disabled for this agent');
    if (context.modelRef !== session.modelRef || resolveAdbPath(context.config.phone.adbPath) !== session.adbPath) throw new PhoneError('PHONE_BINDING_CHANGED', 'Phone model or execution configuration changed; reopen the phone');
    if (context.validateBinding && !context.validateBinding()) throw new PhoneError('PHONE_BINDING_CHANGED', 'Agent model or tool policy changed; reopen the phone');
    if (Date.now() - session.createdAt >= context.config.phone.maxSessionDurationMs) throw new PhoneError('PHONE_SESSION_LIMIT', 'Phone session duration limit reached');
    const current = this.repository.get(session.device.id);
    if (!current.enabled || current.revision !== session.device.revision) throw new PhoneError('PHONE_ACCESS_CHANGED', 'Device access changed; reopen the phone');
    this.repository.renew(session.device.serial, session.lease);
  }
  private allowedScreen(session: Session, observation: PhoneObservation): void {
    if (!phoneAllowsApp(session.device, observation.package)) throw new PhoneError('PHONE_APP_DENIED', 'The foreground application is outside this phone session allowlist. Open an allowed app or reopen with appPackage.');
  }
  async execute(owner: string, raw: PhoneInput, context: ExecutionContext, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
    const input = PhoneInputSchema.parse(raw);
    if (['cancel', 'close', 'pause'].includes(input.op)) return this.stop(owner, input.op as 'cancel' | 'close' | 'pause');
    if (input.op === 'status') return this.status(owner) ?? { status: 'closed' };
    if (!context.config.phone.enabled || context.toolDenied) throw new PhoneError('PHONE_DISABLED', 'Enable Phone Use in settings and allow the tool for this agent');
    if (input.op === 'discover') return { devices: this.repository.list().filter(device => device.enabled), defaultDeviceId: this.repository.defaultDevice() };
    signal.throwIfAborted();
    if (input.op === 'open') {
      if (this.openings.has(owner)) throw new PhoneError('PHONE_SESSION_BUSY', 'A phone is already being opened', 409);
      const opening = new AbortController(); this.openings.set(owner, opening);
      signal = AbortSignal.any([signal, opening.signal]);
      try {
        for (const [key, value] of this.sessions) if (terminal.has(value.report.status)) this.sessions.delete(key);
        if (this.sessions.size >= 50) throw new PhoneError('PHONE_CAPACITY', 'Close an existing phone session before opening another', 409);
        const previous = this.sessions.get(owner);
        if (previous && !terminal.has(previous.report.status)) throw new PhoneError('PHONE_ALREADY_OPEN', 'Close the current phone session before opening another');
        const deviceId = input.deviceId ?? this.repository.defaultDevice();
        if (!deviceId) throw new PhoneError('PHONE_DEVICE_REQUIRED', 'Choose a registered phone in Phone Use settings');
        const device = this.repository.get(deviceId);
        if (!device.enabled) throw new PhoneError('PHONE_DEVICE_DENIED', 'This phone is disabled', 403);
        const modelRef = context.modelRef;
        if (!modelRef) throw new PhoneError('PHONE_MODEL_REQUIRED', 'Choose a Phone Use model in settings');
        const adbPath = resolveAdbPath(context.config.phone.adbPath);
        const driver = await this.driverFor(device, context.config);
        const found = (await driver.discover(signal)).find(item => item.serial === device.serial);
        if (found?.state !== 'device') throw new PhoneError('PHONE_DEVICE_OFFLINE', 'Phone is offline or has not authorized ADB');
        if (modelRef === MOCK_PHONE_MODEL && !found.emulator) throw new PhoneError('PHONE_MOCK_EMULATOR_ONLY', 'The deterministic mock model is only enabled for local Android emulators');
        const lease = this.repository.acquire(device.serial);
        try {
          const adapter = await this.modelFactory(modelRef, context.config, context.agentId);
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
              mock: modelRef === MOCK_PHONE_MODEL, mode: input.mode, status: 'ready', actions: 0, modelRequests: 0, controlOwner: 'agent', controlEpoch: 1, handoff: 'idle',
              createdAt: now, updatedAt: now, verified: false, verificationLevel: 'none', steps: [], diagnostics: { stalePredictions: 0, protocolRepairs: 0, unchangedActions: 0, completionCorrections: 0 } } };
          this.sessions.set(owner, session);
          if (input.appPackage) {
            if (input.mode !== 'control' || !phoneAllowsApp(device, input.appPackage)) throw new PhoneError('PHONE_APP_DENIED', 'Launching requires control mode and an allowed application');
            const epoch = session.report.controlEpoch;
            const observation = await this.observe(session, signal);
            try { await this.dispatch(session, { type: 'launch', package: input.appPackage }, observation, context, signal, epoch); } finally { observation.frame.fill(0); }
          }
          return this.publish(session);
        } catch (error) { this.repository.release(device.serial, lease); this.sessions.delete(owner); throw error; }
      } finally { this.openings.delete(owner); }
    }
    const session = this.sessions.get(owner);
    if (!session || terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Open a phone session first');
    if ((session.human || (session.report.controlOwner === 'none' && !(input.op === 'resume' && session.controller.signal.aborted))) && input.op !== 'run' && input.op !== 'step') throw new PhoneError('PHONE_PAUSED', 'The user controls this phone. Wait for explicit handback in the phone panel', 409);
    if (session.active) throw new PhoneError('PHONE_SESSION_BUSY', 'A phone operation is already running', 409);
    this.guard(session, context);
    if (input.op === 'resume') {
      session.controller = new AbortController(); session.report.controlOwner = 'agent'; session.report.controlEpoch!++; session.report.status = 'ready'; session.report.stopReason = undefined; session.report.message = undefined;
      return this.publish(session);
    }
    if (session.report.status === 'paused' || session.report.status === 'needs_user') throw new PhoneError('PHONE_PAUSED', 'Complete manual interaction and resume the phone session');
    session.budget = new PhoneOperationBudget(context.config.phone.maxOperationDurationMs); if (session.report.controlOwner === 'agent') session.budget.resume();
    const combined = AbortSignal.any([signal, session.controller.signal, session.budget.controller.signal]);
    const operation = this.perform(session, input, context, combined);
    session.active = operation;
    try { return await operation; }
    finally { session.active = undefined; session.budget?.dispose(); session.budget = undefined; }
  }
  private async perform(session: Session, input: Exclude<PhoneInput, { op: 'open' | 'discover' }>, context: ExecutionContext, signal: AbortSignal): Promise<PhoneReport> {
    let observation: PhoneObservation | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const startedAt = Date.now();
    session.report.errorCode = undefined; session.report.verified = false; session.report.verificationLevel = 'none';
    session.report.stopReason = undefined; session.report.message = undefined;
    try {
      await this.waitForAgent(session, signal); session.report.status = 'running';
      this.publish(session);
      heartbeat = setInterval(() => { try { this.guard(session, context); } catch (error) { session.controller.abort(error); } }, 10_000);
      heartbeat.unref();
      observation = await this.observe(session, signal);
      this.allowedScreen(session, observation);
      if (input.op === 'observe') {
        this.recordObservation(session, observation); session.report.status = 'ready'; return this.publish(session);
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
      let changed = false;
      let previousSignature = observationSignature(observation);
      let controlEpoch = session.report.controlEpoch;
      const attempts = new Map<string, number>();
      while (true) {
        if (await this.waitForAgent(session, signal)) { observation.frame.fill(0); observation = await this.observe(session, signal); }
        signal.throwIfAborted(); this.guard(session, context); this.allowedScreen(session, observation);
        const epoch = session.report.controlEpoch;
        if (controlEpoch !== epoch) {
          attempts.clear(); recoveryHint = 'The user handed back control. Re-evaluate the fresh screen before continuing.';
          controlEpoch = epoch;
        }
        const signature = observationSignature(observation);
        if (signature !== previousSignature) changed = true;
        previousSignature = signature;
        this.recordObservation(session, observation);
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
            session.report.verified = true; session.report.verificationLevel = 'ui'; session.report.status = 'completed';
            session.report.stopReason = actions ? 'condition_satisfied' : 'condition_present'; return this.publish(session);
          } finally { if (observation !== confirmation) confirmation.frame.fill(0); }
        }
        if (actions >= maxActions) { session.report.status = 'ready'; session.report.stopReason = 'action_limit'; return this.publish(session); }
        if (session.report.modelRequests >= context.config.phone.maxModelRequests) throw new PhoneError('PHONE_MODEL_LIMIT', 'Phone model request limit reached');
        session.report.modelRequests++; session.report.currentAction = undefined; this.publish(session);
        session.prediction = new AbortController();
        let decision;
        try {
          decision = await session.adapter.predict({ goal: input.goal, observation, completion, allowedApps: session.device.allowedApps, appAccess: phoneAppAccess(session.device),
            applications: session.applications.filter(app => phoneAllowsApp(session.device, app.packageName)),
            history: session.report.steps.map(step => step.action), trajectory: session.trajectory,
            progressSummary: JSON.stringify({ dispatched: session.trajectoryCount,
              earlier: [...session.trajectorySummary, ...session.trajectory.slice(0, -8).map(entry => JSON.stringify({ action: entry.action, effect: entry.effect, afterApp: entry.afterApp }).slice(0, 250))].slice(-12) }).slice(-1500),
            recoveryHint, protocolFeedback, scenario: input.scenario }, AbortSignal.any([signal, session.prediction.signal]));
        } catch (error) {
          if (!signal.aborted && epoch !== session.report.controlEpoch) {
            await this.waitForAgent(session, signal); observation.frame.fill(0); observation = await this.observe(session, signal); continue;
          }
          if (!signal.aborted && error instanceof PhoneError && ['PHONE_MODEL_PROTOCOL', 'PHONE_MODEL_TRUNCATED'].includes(error.code)
            && repairs < 1 && session.report.modelRequests < context.config.phone.maxModelRequests) {
            repairs++; session.report.diagnostics!.protocolRepairs++;
            protocolFeedback = 'Your previous output was invalid or truncated. Return exactly one complete action in the specified format with no extra prose.';
            observation.frame.fill(0); observation = await this.observe(session, signal); continue;
          }
          throw error;
        } finally { session.prediction = undefined; }
        signal.throwIfAborted(); this.guard(session, context);
        if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') {
          await this.waitForAgent(session, signal); observation.frame.fill(0); observation = await this.observe(session, signal); continue;
        }
        protocolFeedback = undefined;
        if (decision.kind !== 'action') {
          if (decision.kind === 'complete' && !session.report.mock && (input.completion || input.expectText)
            && completionCorrections < 1 && session.report.modelRequests < context.config.phone.maxModelRequests) {
            completionCorrections++; session.report.diagnostics!.completionCorrections++;
            recoveryHint = `Your completion claim is not verified. These required native UI conditions are not all satisfied: ${JSON.stringify({ expectText: input.expectText, ...input.completion })}. Recheck the fresh screen, preserve user constraints, and continue if a safe authorized action can satisfy the goal; otherwise report unfinished.`;
            observation.frame.fill(0); observation = await this.observe(session, signal); continue;
          }
          session.report.status = decision.kind === 'needsUser' ? 'needs_user' : 'completed';
          session.report.message = decision.kind === 'needsUser' ? decision.reason : decision.summary;
          session.report.stopReason = decision.kind === 'needsUser' ? 'user_takeover' : 'model_finished_unverified';
          if (decision.kind === 'needsUser' && !session.report.mock) {
            session.report.controlOwner = 'none'; session.report.controlEpoch!++; session.budget?.pause(); this.publish(session);
            await this.waitForAgent(session, signal); observation.frame.fill(0); observation = await this.observe(session, signal); continue;
          }
          return this.publish(session);
        }
        // Re-observe immediately before input. Layout drift discards the proposed coordinates.
        const fresh = await this.observe(session, signal);
        try {
          this.allowedScreen(session, fresh);
          if (!canDispatchPhoneAction(decision.action, observation, fresh)) {
            session.report.diagnostics!.stalePredictions++;
            recoveryHint = 'The proposed action was not dispatched because its target changed. Locate it again on the fresh screen.';
            observation.frame.fill(0); observation = fresh; continue;
          }
          if (epoch !== session.report.controlEpoch || session.report.controlOwner !== 'agent') continue;
          const attemptKey = `${observationSignature(fresh)}:${JSON.stringify(decision.action)}`;
          const repetitions = attempts.get(attemptKey) ?? 0;
          if (repetitions >= (decision.action.type === 'wait' ? 3 : 2)) {
            session.report.status = 'paused'; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
            session.report.stopReason = 'no_progress';
            session.report.message = 'Repeated actions made no progress. Inspect the phone and hand back before continuing.';
            session.budget?.pause(); await session.stream?.revoke(); return this.publish(session);
          }
          attempts.set(attemptKey, repetitions + 1);
          if (await this.dispatch(session, decision.action, fresh, context, signal, epoch)) actions++;
        } finally { if (observation !== fresh) fresh.frame.fill(0); }
        const beforeSignature = observationSignature(observation);
        observation.frame.fill(0); observation = await this.observe(session, signal);
        const entry = session.trajectory.at(-1);
        if (entry && entry.actor === 'agent' && epoch === session.report.controlEpoch) {
          const unchanged = beforeSignature === observationSignature(observation);
          entry.afterApp = observation.package; entry.effect = unchanged ? 'unchanged' : 'changed';
          entry.facts = observation.elements.filter(node => !node.password).flatMap(node => [node.text, node.description]).filter(Boolean).slice(0, 12).map(text => text.slice(0, 160));
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
        session.budget?.pause(); await session.stream?.revoke();
        return this.publish(session);
      }
      if (failure instanceof PhoneError && failure.code === 'PHONE_OPERATION_TIMEOUT'
        && !terminal.has(session.report.status) && session.report.status !== 'paused') {
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
    session.report.foregroundApp = observation.package;
    session.report.facts = [...new Set(observation.elements.flatMap(node => node.password ? [] : [node.text, node.description]).filter(Boolean))].slice(0, 60);
  }
  private async dispatch(session: Session, action: PhoneAction, observation: PhoneObservation, context: ExecutionContext, signal: AbortSignal, epoch = session.report.controlEpoch, resetTask = false): Promise<boolean> {
    return this.io(session, async () => {
      signal.throwIfAborted(); this.guard(session, context);
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
      const entry: PhoneTrajectoryEntry = { action: structuredClone(action), dispatch: 'unknown', actor: step.actor, beforeApp: observation.package, effect: 'unknown' };
      session.trajectory.push(entry); session.trajectoryCount++;
      if (session.trajectory.length > 24) {
        const earlier = session.trajectory.shift()!;
        session.trajectorySummary.push(JSON.stringify({ action: earlier.action, effect: earlier.effect, afterApp: earlier.afterApp }).slice(0, 250));
        session.trajectorySummary = session.trajectorySummary.slice(-12);
      }
      try { await session.driver.execute(session.device.serial, action, observation, signal, session.human ? { settleMs: 0, ...(resetTask ? { resetTask: true } : {}) } : undefined); step.dispatch = 'completed'; entry.dispatch = 'completed'; }
      catch (error) {
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
    session.controller.abort(); session.prediction?.abort(); session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
    if (op === 'pause') await session.stream?.revoke();
    else { await session.stream?.close(); session.stream = undefined; }
    for (const wake of session.wake) wake();
    session.report.status = op === 'pause' ? 'paused' : op === 'cancel' ? 'cancelled' : 'closed';
    session.report.stopReason = op; if (op !== 'close') session.report.verified = false;
    if (op !== 'pause') {
      session.report.facts = undefined; session.report.message = undefined; session.trajectory = []; session.trajectorySummary = []; session.frames.clear();
      session.adapter = { predict: async () => { throw new PhoneError('PHONE_OPEN_REQUIRED', 'Reopen the phone session'); } };
    }
    this.publish(session);
    // Await driver cleanup so resume cannot overlap the previous operation.
    await session.active?.catch(() => {});
    await session.io.catch(() => {});
    if (op !== 'pause') this.repository.release(session.device.serial, session.lease);
    return this.publish(session);
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
      const observation = await observe.call(session.driver, session.device.serial, signal);
      if (phoneAllowsApp(session.device, observation.package)) {
        if (Date.now() - session.viewedAt < 30_000 && !terminal.has(session.report.status)) session.frames.set(observation);
      } else session.frames.clear();
      return observation;
    });
  }
  private async capture(session: Session, signal: AbortSignal): Promise<PhoneObservation> {
    return this.io(session, async () => {
      signal.throwIfAborted(); this.guard(session, session.context);
      const observation = await (session.driver.capture ?? session.driver.observe).call(session.driver, session.device.serial, signal);
      try {
        this.guard(session, session.context); this.allowedScreen(session, observation);
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
    signal.throwIfAborted(); return waited;
  }
  private startMaintenance(): void {
    if (this.maintenance) return;
    this.maintenance = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (terminal.has(session.report.status)) { session.frames.clear(); const stream = session.stream; session.stream = undefined; void stream?.close(); continue; }
        try {
          this.guard(session, session.context);
          if (session.human && Date.now() > (session.humanExpiresAt ?? 0)) {
            session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
            session.report.status = 'paused'; session.report.stopReason = 'control_disconnected'; this.publish(session);
            void session.stream?.revoke().catch(() => this.stop(session.report.owner, 'cancel'));
          }
          if (Date.now() - session.viewedAt > 30_000) session.frames.clear();
        } catch { session.frames.clear(); void this.stop(session.report.owner, 'cancel'); }
      }
    }, 3000);
    this.maintenance.unref();
  }
  private liveSession(owner: string, id: string, context: ExecutionContext): Session {
    const session = this.sessions.get(owner);
    if (!session || session.report.sessionId !== id) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone session not found', 404);
    if (context.agentId !== session.report.agentId) throw new PhoneError('PHONE_ACCESS_CHANGED', 'Agent binding changed', 403);
    if (!terminal.has(session.report.status)) {
      try { this.guard(session, context); } catch (error) { session.frames.clear(); throw error; }
    }
    session.context = context; this.startMaintenance();
    return session;
  }
  liveStatus(owner: string, id: string, context: ExecutionContext, client: string) {
    const session = this.liveSession(owner, id, context);
    return { report: structuredClone(session.report), ownControl: Boolean(session.human === client), allowedApps: [...session.device.allowedApps], appAccess: phoneAppAccess(session.device), textInput: session.device.textInput ?? 'auto',
      frame: session.frames.get() ? { seq: session.frames.get()!.seq, capturedAt: session.frames.get()!.capturedAt } : null };
  }
  async liveVideo(owner: string, id: string, context: ExecutionContext) {
    const session = this.liveSession(owner, id, context);
    if (terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409);
    if (session.streamOpening) return session.streamOpening;
    const opening = this.openLiveVideo(owner, session);
    session.streamOpening = opening;
    try { return await opening; }
    finally { if (session.streamOpening === opening) session.streamOpening = undefined; }
  }
  private async openLiveVideo(owner: string, session: Session): Promise<PhoneInteractiveSession> {
    if (!session.stream) {
      // Opening an app publishes its report before the launch dispatch finishes.
      await session.io;
      if (terminal.has(session.report.status)) throw new PhoneError('PHONE_VIDEO_ENDED', 'Phone session ended', 409);
      const failed = () => { void this.stop(owner, 'cancel'); };
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
          this.guard(session, session.context);
          const app = await provider.foreground(AbortSignal.timeout(2000));
          if (!phoneAllowsApp(session.device, app)) throw new PhoneError('PHONE_APP_DENIED', 'Current page is outside the authorized applications', 403);
          session.viewedAt = Date.now();
        }, (client, epoch) => {
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
  async disconnectVideo(owner: string, id: string, client: string): Promise<void> {
    const session = this.sessions.get(owner);
    if (!session || session.report.sessionId !== id) return;
    if (session.human === client) {
      session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
      session.report.status = 'paused'; session.report.stopReason = 'control_disconnected'; this.publish(session);
      try { await session.stream?.revoke(); } catch { await this.stop(owner, 'cancel'); }
    }
    if (session.stream?.viewerCount === 0) { const stream = session.stream; session.stream = undefined; await stream.close(); }
  }
  async liveFrame(owner: string, id: string, context: ExecutionContext, signal: AbortSignal) {
    const session = this.liveSession(owner, id, context);
    if (terminal.has(session.report.status)) { session.frames.clear(); throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409); }
    session.viewedAt = Date.now();
    if (!session.frames.get() || Date.now() - session.frames.get()!.capturedAt > (session.human ? 150 : 600)) {
      session.preview ??= (async () => {
        const observation = await this.capture(session, signal);
        try { this.guard(session, context); this.allowedScreen(session, observation); }
        catch (error) { session.frames.clear(); throw error; }
        finally { observation.frame.fill(0); }
      })().finally(() => { session.preview = undefined; });
      await session.preview;
    }
    this.guard(session, context);
    const frame = session.frames.get();
    if (!frame) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409);
    return { ...frame, frame: Buffer.from(frame.frame) };
  }
  async liveControl(owner: string, id: string, context: ExecutionContext, client: string, input: {
    op: 'takeover' | 'release' | 'handback' | 'pause' | 'cancel' | 'heartbeat' | 'input' | 'recover';
    epoch: number; operationId: string; frameSeq?: number; geometry?: number; action?: PhoneAction;
  }): Promise<unknown> {
    const session = this.liveSession(owner, id, context);
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
      if (terminal.has(session.report.status)) throw new PhoneError('PHONE_OPEN_REQUIRED', 'Phone session ended', 409);
      this.guard(session, context);
      if (input.epoch !== session.report.controlEpoch) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Control changed. Refresh before trying again.', 409);
      if (session.human && session.human !== client) throw new PhoneError('PHONE_CONTROL_BUSY', 'Another browser window controls this phone', 409);
      if (input.op === 'cancel') { await this.stop(owner, 'cancel'); return this.liveStatus(owner, id, context, client); }
      if (input.op === 'takeover' || input.op === 'pause') {
        if (input.op === 'takeover' && session.report.mode !== 'control') throw new PhoneError('PHONE_OBSERVE_ONLY', 'This phone session only allows observation', 403);
        session.report.controlOwner = 'none'; session.report.controlEpoch!++; session.report.handoff = 'acquiring';
        session.report.status = 'paused'; session.budget?.pause(); session.prediction?.abort(); this.publish(session);
        await session.stream?.revoke();
        await session.io;
        if (terminal.has(session.report.status) || session.report.steps.at(-1)?.dispatch === 'unknown') {
          session.report.handoff = 'idle'; this.publish(session);
          throw new PhoneError('PHONE_DISPATCH_UNKNOWN', 'Inspect the phone before taking control; previous input is unresolved', 409);
        }
        if (session.controller.signal.aborted && !session.active) session.controller = new AbortController();
        session.human = undefined;
        if (input.op === 'takeover') { session.human = client; session.humanExpiresAt = Date.now() + 15_000; session.report.controlOwner = 'human'; }
        session.report.handoff = 'idle'; this.publish(session);
      } else if (input.op === 'release') {
        if (session.human !== client) throw new PhoneError('PHONE_CONTROL_REQUIRED', 'This browser does not control the phone', 409);
        session.human = undefined; session.report.controlOwner = 'none'; session.report.controlEpoch!++;
        await session.stream?.revoke();
        session.report.status = 'paused'; session.report.stopReason = 'user_paused'; this.publish(session);
      } else if (input.op === 'handback') {
        if (session.report.controlOwner === 'agent') throw new PhoneError('PHONE_NOT_PAUSED', 'The Agent already controls this phone', 409);
        // Tool pause aborts its controller after draining the previous operation.
        if (session.controller.signal.aborted && !session.active) session.controller = new AbortController();
        session.report.handoff = 'returning'; session.report.controlEpoch!++; session.human = undefined;
        session.report.controlOwner = 'none'; this.publish(session);
        await session.stream?.revoke();
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
        session.report.controlOwner = 'agent'; session.report.status = session.active ? 'running' : 'ready';
        session.report.handoff = 'idle'; session.report.message = undefined; session.report.stopReason = undefined;
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
        if (!input.action || input.action.type === 'launch' || input.action.type === 'home' || input.action.type === 'wait') throw new PhoneError('PHONE_INVALID_INPUT', 'Unsupported manual input');
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
      return { ...this.liveStatus(owner, id, context, client), resumeTurnRequired: input.op === 'handback' && !session.active };
    });
    session.commands = result.catch(() => {
      if (terminal.has(session.report.status)) {
        session.frames.clear(); this.repository.release(session.device.serial, session.lease);
        session.controller.abort(); for (const wake of session.wake) wake(); this.publish(session);
      }
    }); session.receipts.set(key, { hash, result });
    return result;
  }
  async stopDevice(id: string): Promise<void> { await Promise.all(this.reports().filter(report => report.deviceId === id).map(report => this.stop(report.owner, 'cancel'))); this.cloudPhones?.disconnect(id); }
  async shutdown(): Promise<void> {
    for (const controller of this.openings.values()) controller.abort(); await Promise.all([...this.sessions.keys()].map(owner => this.stop(owner, 'close'))); this.cloudPhones?.close(); this.sessions.clear(); if (this.maintenance) clearInterval(this.maintenance); this.maintenance = undefined; }
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
