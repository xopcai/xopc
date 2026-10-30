import { randomUUID } from 'node:crypto';

import type { PhoneSetupView } from '@xopcai/gateway-contract';

import { getSessionMetadata } from '../../storage/sqlite/session-read-repository.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import type { PhoneInput } from '../contracts.js';
import type { PhoneRuntime } from '../runtime.js';

type Context = { conversationId: string; agentId: string; canConfigure?: boolean; isAuthorized?: () => boolean; runId?: string };
type Setup = Omit<PhoneSetupView, 'readiness' | 'stale' | 'settingsPath' | 'guidanceRefs'> & {
  transcriptId?: string; verificationRunId?: string; automaticAttempts?: number; environmentRevision?: string; calls: number; owner?: string;
};
export interface PhoneSetupMutation { signal: AbortSignal; check: () => void }
export interface PhoneSetupDeps {
  runtime: PhoneRuntime;
  inspect(context: Context, source?: 'local' | 'aliyun' | 'harmonyos'): Promise<PhoneSetupView['readiness']>;
  revision(context: Context, deviceId: string): string;
  connected(deviceId: string, signal?: AbortSignal): Promise<boolean>;
  leaseActive(deviceId: string): boolean;
  setModel?: (agentId: string, ref: string, mutation?: PhoneSetupMutation) => Promise<void>;
  models?: () => Array<{ ref: string; name: string; configured: boolean }>;
  configure?: (enabled: boolean, mutation?: PhoneSetupMutation) => Promise<void>;
  install?: (kind: 'adb' | 'scrcpy' | 'hdc' | 'hoscrcpy' | 'java', repair: boolean, mutation?: PhoneSetupMutation) => Promise<void>;
  registerLocal?: (serial: string, name?: string, mutation?: PhoneSetupMutation, platform?: 'android' | 'harmonyos') => Promise<void>;
}

/** Bounded product actions automate setup; credentials remain in secure product forms. */
export class PhoneSetupService {
  private readonly mutations = new Map<string, { controller: AbortController; committing: boolean; done: Promise<void> }>();
  constructor(private readonly deps: PhoneSetupDeps) {}
  private scopeCurrent(setup: Setup) {
    const metadata = getSessionMetadata(setup.conversationId);
    return setup.transcriptId ? metadata?.transcriptId === setup.transcriptId && metadata.agentId === setup.agentId : !metadata;
  }
  async cancelConversation(conversationId: string) {
    const entries = new DurableState<Setup>('phone.setup', conversationId).entries();
    // Invalidate every Agent's grant before awaiting any external cleanup.
    for (const [agentId, setup] of entries) {
      const context = { conversationId, agentId };
      this.save(context, { ...setup, state: 'cancelled' });
      this.mutations.get(setup.id)?.controller.abort();
    }
    await Promise.all(entries.map(async ([agentId, setup]) => {
      const mutation = this.mutations.get(setup.id);
      if (mutation?.committing) await mutation.done;
      await this.releaseState({ conversationId, agentId }, setup.id);
    }));
  }
  private store(context: Context) { return new DurableState<Setup>('phone.setup', context.conversationId); }
  current(context: Context) { return this.store(context).get(context.agentId); }
  private save(context: Context, next: Setup, expected = next.revision) {
    return this.store(context).update(context.agentId, previous => {
      if (previous && previous.revision !== expected) throw new Error('PHONE_SETUP_CONFLICT: Refresh the saved progress.');
      const value = { ...next, revision: expected + 1 };
      return { value, result: value };
    });
  }
  private owned(context: Context, id: string) {
    const setup = this.current(context);
    if (!setup || setup.id !== id) throw new Error('PHONE_SETUP_NOT_FOUND');
    return setup;
  }
  async view(context: Context, setup: Setup): Promise<PhoneSetupView> {
    const { owner: _owner, calls: _calls, verificationRunId: _run, automaticAttempts: _attempts, environmentRevision: _revision, ...summary } = setup;
    const stale = !this.scopeCurrent(setup) || Boolean(setup.attempt && setup.environmentRevision !== this.deps.revision(context, setup.attempt.deviceId));
    const interrupted = setup.state === 'verifying' && (Date.now() > setup.attempt!.expiresAt || Boolean(setup.attempt?.sessionId && !this.deps.runtime.status(setup.owner!)));
    const readiness = await this.deps.inspect(context, setup.source);
    const step = !readiness.model.ref || !readiness.model.configured || !readiness.model.supported ? 'model'
      : setup.source === 'aliyun' && !readiness.devices.some(device => device.source === 'aliyun' && device.enabled) ? 'connection' : 'manual';
    return { ...summary, stale, state: interrupted ? 'needs_attention' : setup.state,
      error: interrupted ? 'PHONE_SETUP_INTERRUPTED: Release or confirm lease expiry before starting a fresh test.' : setup.error,
      readiness,
      interactionPath: `/configuration/phone/${setup.id}?conversationId=${encodeURIComponent(context.conversationId)}&step=${step}`,
      settingsPath: `/settings/phone-use?phoneSetup=${setup.id}&conversationId=${context.conversationId}`,
      guidanceRefs: [{ sceneId: 'phone', path: `references/phone/${setup.state === 'verifying' ? 'acceptance' : setup.error || interrupted || stale ? 'troubleshooting' : setup.source === 'aliyun' ? 'aliyun' : setup.source === 'harmonyos' ? 'harmonyos' : setup.source === 'local' ? 'local' : 'overview'}.md`, resourceVersion: '1' }],
    };
  }
  async command(command: string, args: Record<string, unknown>, context: Context, dryRun = false) {
    let setup = this.current(context);
    if (command === 'inspect' || command === 'preview' || dryRun) return {
      sceneId: 'phone', skillName: 'configure-xopc', readiness: await this.deps.inspect(context, setup?.source),
      setup: setup ? await this.view(context, setup) : null,
      settingsPath: `/settings/phone-use?conversationId=${context.conversationId}`,
      guidanceRefs: [{ sceneId: 'phone', path: 'references/phone/overview.md', resourceVersion: '1' }], ...(dryRun ? { dryRun: true } : {}),
    };
    if (command === 'start') {
      if (!setup || ['completed', 'cancelled'].includes(setup.state) && (!setup.attempt || setup.attempt.released)) {
        setup = this.save(context, { id: randomUUID(), conversationId: context.conversationId, agentId: context.agentId, transcriptId: getSessionMetadata(context.conversationId)?.transcriptId, state: 'configuring', revision: setup?.revision ?? 0, calls: 0,
          checks: { configured: false, read: false, operated: false, verified: false, released: false } });
      }
      return this.view(context, setup);
    }
    if (command === 'models') return { models: this.deps.models?.() ?? [] };
    if (typeof args.setupId !== 'string') throw new Error('setupId is required');
    setup = this.owned(context, args.setupId);
    if (['get', 'recheck', 'verification_report'].includes(command)) return this.view(context, setup);
    if (command === 'release') return this.release(context, setup.id);
    if (['source', 'configure', 'set_model', 'install_dependency', 'register_local', 'begin_verification'].includes(command)) {
      if (!this.scopeCurrent(setup)) throw new Error('PHONE_SETUP_SCOPE_CHANGED: Start a new setup in the current conversation.');
      if (this.mutations.has(setup.id)) throw new Error('PHONE_SETUP_BUSY: A configuration operation is in progress.');
      if (!context.canConfigure) throw new Error('PHONE_SETUP_INTERACTIVE_REQUIRED: Continue in an authorized interactive conversation.');
      if (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== setup.revision) throw new Error('PHONE_SETUP_CONFLICT: Re-read current progress.');
      if (command === 'source') {
        if (args.source !== 'local' && args.source !== 'aliyun' && args.source !== 'harmonyos') throw new Error('Choose local, harmonyos or aliyun');
        return this.source(context, setup.id, args.source, setup.revision);
      }
      if (command === 'begin_verification') {
        if (typeof args.deviceId !== 'string') throw new Error('Select the exact registered phone with the user before testing');
        return this.begin(context, setup.id, args.deviceId, setup.revision);
      }
      if (setup.attempt && !setup.attempt.released || ['completed', 'cancelled'].includes(setup.state)) throw new Error('PHONE_SETUP_CONFLICT: Release the test or start a fresh setup first.');
      setup = this.save(context, setup);
      const claimed = setup;
      let finish!: () => void;
      const operation = { controller: new AbortController(), committing: false, done: new Promise<void>(resolve => { finish = resolve; }) };
      this.mutations.set(setup.id, operation);
      const mutation: PhoneSetupMutation = { signal: operation.controller.signal, check: () => {
        operation.controller.signal.throwIfAborted();
        const current = this.owned(context, claimed.id);
        if (current.revision !== claimed.revision || current.state === 'cancelled' || !this.scopeCurrent(current)
          || !context.canConfigure || context.isAuthorized?.() === false) throw new Error('PHONE_SETUP_CONFLICT: Configuration authority or progress changed.');
      } };
      try {
        if (command === 'configure') {
          if (!this.deps.configure || typeof args.enabled !== 'boolean') throw new Error('Phone configuration is unavailable');
          if ((await this.deps.inspect(context, setup.source)).enabled !== args.enabled) { mutation.check(); operation.committing = true; await this.deps.configure(args.enabled, mutation); }
        } else if (command === 'set_model') {
          if (!this.deps.setModel || typeof args.modelRef !== 'string') throw new Error('Choose a compatible configured Phone model');
          const current = (await this.deps.inspect(context, setup.source)).model;
          if (current.ref !== args.modelRef) {
            if (current.ref && current.supported && current.configured && args.replaceExisting !== true) throw new Error('PHONE_SETUP_MODEL_CHANGE_REQUIRED: A working Phone model is already configured. Confirm the intended replacement with the user.');
            mutation.check(); operation.committing = true;
            await this.deps.setModel(context.agentId, args.modelRef, mutation);
          }
        } else if (command === 'install_dependency') {
          if (!this.deps.install || !['adb', 'scrcpy', 'hdc', 'hoscrcpy', 'java', 'harmonyos'].includes(String(args.kind)) || args.repair !== undefined && typeof args.repair !== 'boolean') throw new Error('Choose a managed Phone dependency');
          if (args.kind === 'adb' && setup.source === 'aliyun') throw new Error('Cloud direct connections do not need local ADB');
          const kinds = args.kind === 'harmonyos' ? ['hdc', 'java', 'hoscrcpy'] as const : [args.kind as 'adb' | 'scrcpy' | 'hdc' | 'java' | 'hoscrcpy'];
          for (const kind of kinds) {
            const readiness = await this.deps.inspect(context, setup.source);
            const dependency = readiness.dependencies.find(item => item.kind === kind);
            if (dependency?.state !== 'ready' || args.repair === true) {
              if (!dependency?.canInstall) throw new Error(`PHONE_SETUP_INSTALL_UNAVAILABLE: ${kind} cannot be installed. Review runtime download settings or use an existing verified dependency.`);
              mutation.check(); operation.committing = true;
              await this.deps.install(kind, args.repair === true, mutation);
              mutation.check();
              if (!(await this.deps.inspect(context, setup.source)).dependencies.some(item => item.kind === kind && item.state === 'ready')) throw new Error(`PHONE_SETUP_INSTALL_UNVERIFIED: ${kind} is not ready after installation.`);
            }
          }
        } else {
          if (!this.deps.registerLocal || !['local', 'harmonyos'].includes(setup.source ?? '') || typeof args.serial !== 'string' || args.name !== undefined && (typeof args.name !== 'string' || args.name.length > 100)) throw new Error('Select a discovered local phone');
          mutation.check(); operation.committing = true;
          await this.deps.registerLocal(args.serial, args.name as string | undefined, mutation, setup.source === 'harmonyos' ? 'harmonyos' : 'android');
        }
        mutation.check();
        return this.view(context, this.save(context, this.owned(context, setup.id)));
      } finally { this.mutations.delete(setup.id); finish(); }
    }
    if (command === 'cancel') {
      setup = this.save(context, { ...setup, state: 'cancelled' });
      const mutation = this.mutations.get(setup.id); mutation?.controller.abort();
      if (mutation?.committing) await mutation.done;
      return this.release(context, setup.id);
    }
    throw new Error('Unsupported phone_setup command');
  }
  async source(context: Context, id: string, source: 'local' | 'aliyun' | 'harmonyos', revision: number) {
    const setup = this.owned(context, id);
    if (!this.scopeCurrent(setup)) throw new Error('PHONE_SETUP_SCOPE_CHANGED: Start a new setup in the current conversation.');
    if (setup.revision !== revision || setup.attempt && !setup.attempt.released) throw new Error('PHONE_SETUP_CONFLICT: Release the active test before changing connection.');
    if (setup.state === 'cancelled' || setup.state === 'completed') throw new Error('PHONE_SETUP_CLOSED: Start a new setup before changing connection.');
    return this.view(context, this.save(context, { ...setup, source }));
  }
  async begin(context: Context, id: string, deviceId: string, revision: number, signal?: AbortSignal) {
    let setup = this.owned(context, id);
    if (context.runId && setup.verificationRunId === context.runId && (setup.automaticAttempts ?? 0) >= 2) throw new Error('PHONE_SETUP_RETRY_LIMIT: Two attempts in this turn failed. Release control and report the external blocker; wait for a fresh user request.');
    if (!this.scopeCurrent(setup) || setup.revision !== revision || setup.state === 'cancelled' || setup.attempt && !setup.attempt.released) throw new Error('PHONE_SETUP_CONFLICT: Refresh progress and release the old test.');
    const environmentRevision = this.deps.revision(context, deviceId);
    const readiness = await this.deps.inspect(context, setup.source);
    const device = readiness.devices.find(device => device.id === deviceId);
    if (!readiness.enabled || !readiness.toolAllowed) throw new Error('PHONE_SETUP_PERMISSION_REQUIRED: Enable Phone Use and allow this Agent in product settings.');
    if (!readiness.model.ref || !readiness.model.supported || !readiness.model.configured) throw new Error('PHONE_SETUP_MODEL_REQUIRED: Save a configured real Phone Use model.');
    if (!device?.enabled || !device.settingsAllowed) throw new Error('PHONE_SETUP_DEVICE_REQUIRED: Choose an enabled phone allowing Settings.');
    if (setup.source && setup.source !== device.source) throw new Error('PHONE_SETUP_SOURCE_MISMATCH');
    if (device.source === 'local' && !readiness.dependencies.some(item => item.kind === 'adb' && item.state === 'ready')) throw new Error('PHONE_SETUP_ADB_REQUIRED');
    if (device.source === 'harmonyos' && !readiness.dependencies.some(item => item.kind === 'hdc' && item.state === 'ready')) throw new Error('PHONE_SETUP_HDC_REQUIRED');
    if (!await this.deps.connected(deviceId, signal)) throw new Error('PHONE_SETUP_DEVICE_OFFLINE: Authorize USB debugging or check cloud connection.');
    const latest = this.owned(context, id);
    if (!this.scopeCurrent(latest) || latest.revision !== revision || environmentRevision !== this.deps.revision(context, deviceId)) throw new Error('PHONE_SETUP_CONFLICT');
    const attempt = { id: randomUUID(), deviceId, modelRef: readiness.model.ref,
      goal: device.source === 'harmonyos' ? 'In HarmonyOS Settings, open About phone and read the HarmonyOS version. Do not change any setting.' : 'From the Android Settings About phone page, open Android version details and read the version. Do not change any setting.',
      completion: { appPackage: device.source === 'harmonyos' ? 'com.huawei.hmos.settings' : 'com.android.settings', textAny: device.source === 'harmonyos' ? ['HarmonyOS', '鸿蒙'] : ['Android version', 'Android 版本', 'Android版本'], requireChange: true },
      maxActions: 6, expiresAt: Date.now() + 300_000, released: false };
    setup = this.save(context, { ...latest, state: 'verifying', source: device.source, error: undefined, attempt,
      owner: `phone-setup:${latest.id}:${attempt.id}`, environmentRevision, calls: 0,
      verificationRunId: context.runId, automaticAttempts: context.runId && latest.verificationRunId === context.runId ? (latest.automaticAttempts ?? 0) + 1 : 1,
      checks: { configured: true, read: false, operated: false, verified: false, released: false } });
    return this.view(context, setup);
  }
  beforeInput(context: Context, input: PhoneInput): { owner: string; input: PhoneInput } | undefined {
    const setup = this.current(context);
    if (!setup?.attempt || setup.attempt.released || input.op === 'discover') return undefined;
    const cleanup = input.op === 'close' || input.op === 'cancel';
    if (!cleanup && (!this.scopeCurrent(setup) || setup.state !== 'verifying' || Date.now() > setup.attempt.expiresAt || setup.calls >= 12
      || setup.environmentRevision !== this.deps.revision(context, setup.attempt.deviceId))) throw new Error('PHONE_SETUP_STOPPED: Release the setup test and review the current state.');
    const allowed = cleanup || input.op === 'status' || input.op === 'observe' || input.op === 'pause'
      || input.op === 'open' && input.deviceId === setup.attempt.deviceId && input.mode === 'control' && input.appPackage === setup.attempt.completion.appPackage
      || (input.op === 'run' || input.op === 'step') && input.goal === setup.attempt.goal && !input.scenario
        && input.completion?.appPackage === setup.attempt.completion.appPackage && input.completion.requireChange === true
        && JSON.stringify(input.completion.textAny) === JSON.stringify(setup.attempt.completion.textAny) && !input.completion.textAll && !input.completion.field && (input.maxActions ?? 6) <= 6;
    if (!allowed) throw new Error('PHONE_SETUP_ACTION_DENIED: Use only the approved Settings test.');
    this.save(context, { ...setup, calls: setup.calls + 1 });
    if (input.op === 'run' || input.op === 'step') {
      const report = this.deps.runtime.status(setup.owner!);
      // Opening Settings is a host preparation action, separate from the model navigation budget.
      const openingActions = report?.steps[0]?.action === 'launch' ? 1 : 0;
      const remaining = 6 - Math.max(0, (report?.actions ?? 0) - openingActions);
      if (remaining <= 0) throw new Error('PHONE_SETUP_BUDGET_EXHAUSTED: Close the test and review its evidence.');
      return { owner: setup.owner!, input: { ...input, maxActions: Math.min(input.maxActions ?? 6, remaining) } };
    }
    return { owner: setup.owner!, input: input.op === 'open' && setup.source !== 'harmonyos' ? { ...input, settingsPage: 'about-phone' } : input };
  }
  afterInput(context: Context, owner: string, op: PhoneInput['op']) {
    const setup = this.current(context);
    if (!setup?.attempt || setup.owner !== owner) return;
    const report = this.deps.runtime.status(owner);
    if (!report || report.deviceId !== setup.attempt.deviceId || report.modelRef !== setup.attempt.modelRef
      || setup.attempt.sessionId && report.sessionId !== setup.attempt.sessionId) return;
    const released = op === 'close' && report.status === 'closed' && report.controlOwner === 'none';
    const valid = this.scopeCurrent(setup) && setup.state === 'verifying' && setup.environmentRevision === this.deps.revision(context, report.deviceId) && Date.now() <= setup.attempt.expiresAt;
    const modelActions = Math.max(0, report.actions - (report.steps[0]?.action === 'launch' ? 1 : 0));
    const verified = valid && !report.mock && report.mode === 'control' && report.verified && report.verificationLevel === 'ui' && report.modelRequests > 0 && modelActions > 0;
    const checks = { ...setup.checks,
      ...(valid ? { read: setup.checks.read || Boolean(report.facts?.length), operated: setup.checks.operated || modelActions > 0,
        verified: setup.checks.verified || verified } : {}), released: setup.checks.released || released };
    this.save(context, { ...setup, checks, attempt: { ...setup.attempt, sessionId: report.sessionId, released: checks.released },
      state: setup.state === 'cancelled' ? 'cancelled' : released ? valid && checks.verified && checks.read ? 'completed' : 'needs_attention' : setup.state,
      error: released && !(valid && checks.verified && checks.read) ? report.errorCode === 'PHONE_MODEL_QUOTA_EXHAUSTED' ? 'PHONE_MODEL_QUOTA_EXHAUSTED: Wait for the Phone model quota to reset or select a configured compatible model; device control was released.' : 'PHONE_SETUP_INCOMPLETE: Review progress and start a fresh test.' : setup.error });
  }
  async release(context: Context, id: string) { return this.view(context, await this.releaseState(context, id)); }
  private async releaseState(context: Context, id: string) {
    let setup = this.owned(context, id);
    if (!setup.attempt || setup.attempt.released) return setup;
    if (!this.deps.runtime.status(setup.owner!)) {
      if (this.deps.leaseActive(setup.attempt.deviceId)) throw new Error('PHONE_SETUP_LEASE_PENDING: Control expiry is not confirmed yet. Wait and recheck.');
      setup = this.save(context, { ...setup, state: setup.state === 'cancelled' ? 'cancelled' : 'needs_attention',
        attempt: { ...setup.attempt, released: true }, checks: { ...setup.checks, released: true }, error: 'PHONE_SETUP_RESTARTED: Lease expiry confirmed; start a fresh test.' });
    } else {
      await this.deps.runtime.stop(setup.owner!, 'close'); this.afterInput(context, setup.owner!, 'close');
      setup = this.owned(context, id);
    }
    if (!setup.attempt?.released) throw new Error('PHONE_SETUP_RELEASE_UNCONFIRMED: Recheck control before resetting the conversation.');
    return setup;
  }
}
