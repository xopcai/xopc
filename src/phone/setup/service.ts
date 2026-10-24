import { randomUUID } from 'node:crypto';

import type { PhoneSetupView } from '@xopcai/gateway-contract';

import { DurableState } from '../../storage/sqlite/durable-state.js';
import type { PhoneInput } from '../contracts.js';
import type { PhoneRuntime } from '../runtime.js';

type Context = { conversationId: string; agentId: string };
type Setup = Omit<PhoneSetupView, 'readiness' | 'stale' | 'settingsPath' | 'guidanceRefs'> & {
  environmentRevision?: string; calls: number; owner?: string;
};
export interface PhoneSetupDeps {
  runtime: PhoneRuntime;
  inspect(context: Context, source?: 'local' | 'aliyun'): Promise<PhoneSetupView['readiness']>;
  revision(context: Context, deviceId: string): string;
  connected(deviceId: string, signal?: AbortSignal): Promise<boolean>;
  leaseActive(deviceId: string): boolean;
}

/** Setup only orchestrates existing settings; secrets and configuration writes stay in product forms. */
export class PhoneSetupService {
  constructor(private readonly deps: PhoneSetupDeps) {}
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
    const { owner: _owner, calls: _calls, environmentRevision: _revision, ...summary } = setup;
    const stale = Boolean(setup.attempt && setup.environmentRevision !== this.deps.revision(context, setup.attempt.deviceId));
    const interrupted = setup.state === 'verifying' && (Date.now() > setup.attempt!.expiresAt || Boolean(setup.attempt?.sessionId && !this.deps.runtime.status(setup.owner!)));
    return { ...summary, stale, state: interrupted ? 'needs_attention' : setup.state,
      error: interrupted ? 'PHONE_SETUP_INTERRUPTED: Release or confirm lease expiry before starting a fresh test.' : setup.error,
      readiness: await this.deps.inspect(context, setup.source),
      settingsPath: `/settings/phone-use?phoneSetup=${setup.id}&conversationId=${context.conversationId}`,
      guidanceRefs: [{ sceneId: 'phone', path: `references/phone/${setup.state === 'verifying' ? 'acceptance' : setup.error || interrupted || stale ? 'troubleshooting' : setup.source === 'aliyun' ? 'aliyun' : setup.source === 'local' ? 'local' : 'overview'}.md`, resourceVersion: '1' }],
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
        setup = this.save(context, { id: randomUUID(), ...context, state: 'configuring', revision: setup?.revision ?? 0, calls: 0,
          checks: { configured: false, read: false, operated: false, verified: false, released: false } });
      }
      return this.view(context, setup);
    }
    if (typeof args.setupId !== 'string') throw new Error('setupId is required');
    setup = this.owned(context, args.setupId);
    if (['get', 'recheck', 'verification_report'].includes(command)) return this.view(context, setup);
    if (command === 'begin_verification') return { ...await this.view(context, setup), message: 'Choose the phone and approve the Settings-only test in the original conversation panel.' };
    if (command === 'cancel') {
      setup = this.save(context, { ...setup, state: 'cancelled' });
      return this.release(context, setup.id);
    }
    throw new Error('Unsupported phone_setup command');
  }
  async source(context: Context, id: string, source: 'local' | 'aliyun', revision: number) {
    const setup = this.owned(context, id);
    if (setup.revision !== revision || setup.attempt && !setup.attempt.released) throw new Error('PHONE_SETUP_CONFLICT: Release the active test before changing connection.');
    if (setup.state === 'cancelled' || setup.state === 'completed') throw new Error('PHONE_SETUP_CLOSED: Start a new setup before changing connection.');
    return this.view(context, this.save(context, { ...setup, source }));
  }
  async begin(context: Context, id: string, deviceId: string, revision: number, signal?: AbortSignal) {
    let setup = this.owned(context, id);
    if (setup.revision !== revision || setup.state === 'cancelled' || setup.attempt && !setup.attempt.released) throw new Error('PHONE_SETUP_CONFLICT: Refresh progress and release the old test.');
    const environmentRevision = this.deps.revision(context, deviceId);
    const readiness = await this.deps.inspect(context, setup.source);
    const device = readiness.devices.find(device => device.id === deviceId);
    if (!readiness.enabled || !readiness.toolAllowed) throw new Error('PHONE_SETUP_PERMISSION_REQUIRED: Enable Phone Use and allow this Agent in product settings.');
    if (!readiness.model.ref || !readiness.model.supported || !readiness.model.configured) throw new Error('PHONE_SETUP_MODEL_REQUIRED: Save a configured real Phone Use model.');
    if (!device?.enabled || !device.settingsAllowed) throw new Error('PHONE_SETUP_DEVICE_REQUIRED: Choose an enabled phone allowing Settings.');
    if (setup.source && setup.source !== device.source) throw new Error('PHONE_SETUP_SOURCE_MISMATCH');
    if (device.source === 'local' && !readiness.dependencies.some(item => item.kind === 'adb' && item.state === 'ready')) throw new Error('PHONE_SETUP_ADB_REQUIRED');
    if (!await this.deps.connected(deviceId, signal)) throw new Error('PHONE_SETUP_DEVICE_OFFLINE: Authorize USB debugging or check cloud connection.');
    const latest = this.owned(context, id);
    if (latest.revision !== revision || environmentRevision !== this.deps.revision(context, deviceId)) throw new Error('PHONE_SETUP_CONFLICT');
    const attempt = { id: randomUUID(), deviceId, modelRef: readiness.model.ref,
      goal: 'From the Android Settings About phone page, open Android version details and read the version. Do not change any setting.',
      completion: { appPackage: 'com.android.settings', textAny: ['Android version', 'Android 版本', 'Android版本'], requireChange: true },
      maxActions: 6, expiresAt: Date.now() + 300_000, released: false };
    setup = this.save(context, { ...latest, state: 'verifying', source: device.source, error: undefined, attempt,
      owner: `phone-setup:${latest.id}:${attempt.id}`, environmentRevision, calls: 0,
      checks: { configured: true, read: false, operated: false, verified: false, released: false } });
    return this.view(context, setup);
  }
  beforeInput(context: Context, input: PhoneInput): { owner: string; input: PhoneInput } | undefined {
    const setup = this.current(context);
    if (!setup?.attempt || setup.attempt.released || input.op === 'discover') return undefined;
    const cleanup = input.op === 'close' || input.op === 'cancel';
    if (!cleanup && (setup.state !== 'verifying' || Date.now() > setup.attempt.expiresAt || setup.calls >= 12
      || setup.environmentRevision !== this.deps.revision(context, setup.attempt.deviceId))) throw new Error('PHONE_SETUP_STOPPED: Release the setup test and review the current state.');
    const allowed = cleanup || input.op === 'status' || input.op === 'observe' || input.op === 'pause'
      || input.op === 'open' && input.deviceId === setup.attempt.deviceId && input.mode === 'control' && input.appPackage === 'com.android.settings'
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
    return { owner: setup.owner!, input: input.op === 'open' ? { ...input, settingsPage: 'about-phone' } : input };
  }
  afterInput(context: Context, owner: string, op: PhoneInput['op']) {
    const setup = this.current(context);
    if (!setup?.attempt || setup.owner !== owner) return;
    const report = this.deps.runtime.status(owner);
    if (!report || report.deviceId !== setup.attempt.deviceId || report.modelRef !== setup.attempt.modelRef
      || setup.attempt.sessionId && report.sessionId !== setup.attempt.sessionId) return;
    const released = op === 'close' && report.status === 'closed' && report.controlOwner === 'none';
    const valid = setup.state === 'verifying' && setup.environmentRevision === this.deps.revision(context, report.deviceId) && Date.now() <= setup.attempt.expiresAt;
    const modelActions = Math.max(0, report.actions - (report.steps[0]?.action === 'launch' ? 1 : 0));
    const verified = valid && !report.mock && report.mode === 'control' && report.verified && report.verificationLevel === 'ui' && report.modelRequests > 0 && modelActions > 0;
    const checks = { ...setup.checks,
      ...(valid ? { read: setup.checks.read || Boolean(report.facts?.length), operated: setup.checks.operated || modelActions > 0,
        verified: setup.checks.verified || verified } : {}), released: setup.checks.released || released };
    this.save(context, { ...setup, checks, attempt: { ...setup.attempt, sessionId: report.sessionId, released: checks.released },
      state: setup.state === 'cancelled' ? 'cancelled' : released ? valid && checks.verified && checks.read ? 'completed' : 'needs_attention' : setup.state,
      error: released && !(valid && checks.verified && checks.read) ? report.errorCode === 'PHONE_MODEL_QUOTA_EXHAUSTED' ? 'PHONE_MODEL_QUOTA_EXHAUSTED: Wait for the Phone model quota to reset or select a configured compatible model; device control was released.' : 'PHONE_SETUP_INCOMPLETE: Review progress and start a fresh test.' : setup.error });
  }
  async release(context: Context, id: string) {
    let setup = this.owned(context, id);
    if (!setup.attempt || setup.attempt.released) return this.view(context, setup);
    if (!this.deps.runtime.status(setup.owner!)) {
      if (this.deps.leaseActive(setup.attempt.deviceId)) throw new Error('PHONE_SETUP_LEASE_PENDING: Control expiry is not confirmed yet. Wait and recheck.');
      setup = this.save(context, { ...setup, state: setup.state === 'cancelled' ? 'cancelled' : 'needs_attention',
        attempt: { ...setup.attempt, released: true }, checks: { ...setup.checks, released: true }, error: 'PHONE_SETUP_RESTARTED: Lease expiry confirmed; start a fresh test.' });
    } else {
      await this.deps.runtime.stop(setup.owner!, 'close'); this.afterInput(context, setup.owner!, 'close');
      setup = this.owned(context, id);
    }
    return this.view(context, setup);
  }
}
