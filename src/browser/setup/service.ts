import { createHash, randomUUID } from 'node:crypto';

import { BROWSER_CONTROL_ENDPOINT_TOOL_NAME, type BrowserActionInput, type BrowserControlResult } from '@xopcai/browser-control-contract';

import type { BrowserSetupView } from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import { getBrowserTabBinding } from '../../storage/sqlite/browser-tab-binding-repository.js';
import { createLogger } from '../../utils/logger.js';
import { createBrowserSetup, findBrowserSetup, readBrowserSetup, saveBrowserSetup } from './repository.js';
import type { BrowserSetup } from './types.js';

const log = createLogger('BrowserSetup');
const VERSION = '1';
const MAX_ACTIONS = 12;
const VERIFY_MS = 120_000;
const ref = (name: string, section?: string) => ({ sceneId: 'browser', path: `references/browser/${name}.md`, resourceVersion: VERSION, ...(section ? { section } : {}) });
export const browserConfigRevision = (config: Config) => createHash('sha256').update(JSON.stringify(config.browser)).digest('hex');

export interface BrowserSetupDeps {
  getConfig: () => Config;
  saveConfig: (next: Config, expected: Config) => Promise<{ saved: boolean; error?: string }>;
  endpoints: EndpointToolRuntime;
  canUseBrowser: (agentId: string) => boolean;
  canSwitchDriver?: (conversationId: string) => boolean;
  policyRevision?: (agentId: string) => string;
  prepare: () => Promise<unknown>;
  release: (endpointId: string, sessionId: string) => Promise<BrowserControlResult>;
  open: (action: 'chrome' | 'folder' | 'both') => Promise<unknown>;
  doctor: () => Promise<{ installed: boolean; needsRefresh?: boolean; extensionDir?: string; nativeHost?: { installed: boolean } }>;
}

/** Mutations require a local-owner grant created by the product UI, never model-supplied identity. */
export class BrowserSetupService {
  private readonly preparing = new Set<string>();
  constructor(private readonly deps: BrowserSetupDeps) {}

  private policyRevision(agentId: string) { return this.deps.policyRevision?.(agentId) ?? String(this.deps.canUseBrowser(agentId)); }

  endpoints() {
    return this.deps.endpoints.registry.list().filter(e => e.kind === 'browser' && e.tools.some(t => t.descriptor.name === BROWSER_CONTROL_ENDPOINT_TOOL_NAME))
      .map(e => ({ endpointId: e.endpointId, principalId: e.principalId, displayName: e.displayName, appVersion: e.appVersion }));
  }

  owned(id: string, conversationId: string, agentId: string) {
    const setup = readBrowserSetup(id);
    if (!setup || setup.conversationId !== conversationId || setup.agentId !== agentId) throw new Error('SETUP_NOT_FOUND');
    return setup;
  }

  view(setup: BrowserSetup): BrowserSetupView & Record<string, unknown> {
    if (setup.state === 'verifying' && setup.attempt && Date.now() > setup.attempt.expiresAt) {
      setup = { ...setup, state: 'needs_attention', error: 'VERIFICATION_EXPIRED: Release the demo session before starting a new test.' };
    }
    const attempt = setup.attempt ? (({ observation: _observation, ...summary }) => summary)(setup.attempt) : undefined;
    const endpoint = setup.attempt ? this.endpoints().find(e => e.endpointId === setup.attempt!.endpointId) : undefined;
    const changed = setup.configRevision !== browserConfigRevision(this.deps.getConfig()) || Boolean(setup.attempt && (setup.attempt.policyRevision !== this.policyRevision(setup.agentId) || !this.deps.canUseBrowser(setup.agentId) || (endpoint && (endpoint.principalId !== setup.attempt.principalId || endpoint.appVersion !== setup.attempt.appVersion))));
    return { ...setup, attempt: setup.attempt ? attempt : undefined, sceneId: 'browser', skillName: 'configure-xopc', resourceVersion: VERSION,
      stale: changed, toolPermission: this.deps.canUseBrowser(setup.agentId) ? 'allowed' : 'denied', currentDriverKind: this.deps.getConfig().browser.driver.kind, endpoints: this.endpoints(), settingsPath: `/settings/agent-browser?browserSetup=${setup.id}&conversationId=${setup.conversationId}`,
      checks: { configured: this.deps.getConfig().browser.enabled && this.deps.getConfig().browser.driver.kind === 'extension',
        read: setup.attempt?.read ?? false, clicked: setup.attempt?.clicked ?? false, filled: setup.attempt?.filled ?? false, released: setup.attempt?.released ?? false },
      guidanceRefs: [ref(setup.state === 'verifying' || setup.state === 'completed' ? 'acceptance' : setup.error ? 'troubleshooting' : 'chrome-extension')],
      allowedActions: setup.state === 'cancelled' ? ['get'] : setup.state === 'completed' ? ['get', 'verification_report'] : ['get', 'recheck', 'cancel', ...(setup.approvedBy && !changed ? ['advance'] : [])],
    };
  }

  async inspect(conversationId: string, agentId: string) {
    const config = this.deps.getConfig();
    const existing = findBrowserSetup(conversationId, agentId);
    const installation = await this.deps.doctor();
    return { sceneId: 'browser', supportedConnection: 'extension', configRevision: browserConfigRevision(config),
      installation: { installed: installation.installed, needsRefresh: installation.needsRefresh ?? false, nativeHostInstalled: installation.nativeHost?.installed === true },
      toolPermission: this.deps.canUseBrowser(agentId) ? 'allowed' : 'denied',
      enabled: config.browser.enabled, driverKind: config.browser.driver.kind, sharedScope: 'gateway', endpoints: this.endpoints(),
      setup: existing ? this.view(existing) : null, guidanceRefs: [ref('overview')],
      ownerActionRequired: true, supportedActions: ['inspect', 'preview', 'start', 'get', 'advance', 'recheck', 'request_interaction', 'begin_verification', 'verification_report', 'cancel'],
    };
  }

  async command(command: string, args: Record<string, unknown>, context: { conversationId: string; agentId: string }, dryRun = false) {
    if (command === 'inspect' || command === 'preview') return this.inspect(context.conversationId, context.agentId);
    if (dryRun) return { dryRun: true, ...(await this.inspect(context.conversationId, context.agentId)), message: 'No changes made. Open the product setup panel to approve installation.' };
    if (command === 'start') {
      const previous = findBrowserSetup(context.conversationId, context.agentId);
      if (previous?.attempt && !previous.attempt.released) return this.view(previous);
      if (previous && this.view(previous).stale && (!previous.attempt || previous.attempt.released)) this.cancel(previous);
      return this.view(createBrowserSetup(context.conversationId, context.agentId, browserConfigRevision(this.deps.getConfig())));
    }
    if (typeof args.setupId !== 'string') throw new Error('setupId is required');
    const setup = this.owned(args.setupId, context.conversationId, context.agentId);
    if (command === 'get' || command === 'verification_report' || command === 'request_interaction') return this.view(setup);
    if (command === 'recheck') return this.view(await this.recheck(setup));
    if (command === 'advance') {
      if (!setup.approvedBy) return { ...this.view(setup), message: 'Approve this plan in the local-owner setup panel first.' };
      return this.view(await this.prepare(setup));
    }
    if (command === 'begin_verification') return { ...this.view(setup), message: 'Select Chrome and start the test in the local-owner setup panel. The test uses normal browser_use calls.' };
    if (command === 'cancel') return this.view(this.cancel(setup));
    throw new Error('Unsupported browser_setup command');
  }

  approve(setup: BrowserSetup, principalId: string, revision: number) {
    this.revision(setup, revision);
    if (setup.state === 'cancelled' || setup.state === 'verifying' || setup.state === 'completed') throw new Error('SETUP_STATE_CHANGED');
    if (setup.configRevision !== browserConfigRevision(this.deps.getConfig())) throw new Error('CONFIG_CHANGED: Review the current configuration before approving.');
    return saveBrowserSetup({ ...setup, approvedBy: principalId, error: undefined }, setup.revision);
  }

  private revision(setup: BrowserSetup, revision: number) {
    if (setup.revision !== revision) throw new Error('SETUP_CONFLICT: Read the current progress.');
  }

  async prepare(setup: BrowserSetup) {
    if (!setup.approvedBy || setup.state === 'cancelled' || setup.state === 'verifying' || setup.state === 'completed') throw new Error('OWNER_APPROVAL_REQUIRED');
    if (setup.attempt && !setup.attempt.released) throw new Error('CONTROL_RELEASE_REQUIRED');
    if (this.preparing.has(setup.id)) return readBrowserSetup(setup.id)!;
    if (['waiting_extension', 'ready_for_verification'].includes(setup.state) && !setup.error) return this.recheck(setup);
    const config = this.deps.getConfig();
    if (setup.configRevision !== browserConfigRevision(config)) throw new Error('CONFIG_CHANGED: Review a new plan.');
    if (config.browser.enabled && config.browser.driver.kind !== 'extension' && this.deps.canSwitchDriver?.(setup.conversationId) === false) {
      return saveBrowserSetup({ ...setup, state: 'needs_attention', error: 'BROWSER_BUSY: Release existing browser sessions and wait for other runs before switching the shared driver.' }, setup.revision);
    }
    this.preparing.add(setup.id);
    let current = saveBrowserSetup({ ...setup, state: 'preparing', error: undefined, operation: { key: setup.operation?.key ?? randomUUID(), startedAt: Date.now() } }, setup.revision);
    try {
      const next = structuredClone(config);
      next.browser.enabled = true;
      next.browser.driver = { kind: 'extension' };
      if (browserConfigRevision(next) !== browserConfigRevision(config)) {
        const result = await this.deps.saveConfig(next, config);
        if (!result.saved) throw new Error('CONFIG_CHANGED: Configuration was not saved. Review the current settings.');
      }
      current = readBrowserSetup(setup.id)!;
      if (current.state === 'cancelled') return current;
      current = saveBrowserSetup({ ...current, configRevision: browserConfigRevision(this.deps.getConfig()) }, current.revision);
      await this.deps.prepare();
      current = readBrowserSetup(setup.id)!;
      if (current.state === 'cancelled') return current;
      this.preparing.delete(setup.id);
      return await this.recheck(saveBrowserSetup({ ...current, state: 'waiting_extension', operation: undefined }, current.revision));
    } catch (error) {
      log.warn({ err: error, setupId: setup.id }, 'Browser setup preparation failed');
      current = readBrowserSetup(setup.id)!;
      if (current.state === 'cancelled') return current;
      return saveBrowserSetup({ ...current, state: 'needs_attention', operation: undefined, error: 'PREPARE_FAILED: Check the local installation and retry. Existing settings and files may have been prepared.' }, current.revision);
    } finally { this.preparing.delete(setup.id); }
  }

  async recheck(setup: BrowserSetup) {
    if (setup.state === 'cancelled' || setup.state === 'completed' || setup.state === 'verifying' || this.preparing.has(setup.id)) return setup;
    if (!setup.approvedBy || (setup.attempt && !setup.attempt.released)) return setup;
    if (setup.configRevision !== browserConfigRevision(this.deps.getConfig())) {
      return saveBrowserSetup({ ...setup, state: 'needs_attention', approvedBy: undefined, error: 'CONFIG_CHANGED: Restart the plan using the current settings.' }, setup.revision);
    }
    const doctor = await this.deps.doctor();
    const current = readBrowserSetup(setup.id)!;
    if (current.revision !== setup.revision) return current;
    const ready = doctor.installed && !doctor.needsRefresh && doctor.nativeHost?.installed === true;
    return saveBrowserSetup({ ...setup, state: ready ? this.endpoints().length ? 'ready_for_verification' : 'waiting_extension' : 'needs_attention',
      operation: undefined, error: ready ? undefined : 'INSTALLATION_REQUIRED: Prepare or repair the local extension files.' }, setup.revision);
  }

  async open(setup: BrowserSetup, action: 'chrome' | 'folder' | 'both') {
    if (!setup.approvedBy || setup.state === 'cancelled') throw new Error('OWNER_APPROVAL_REQUIRED');
    return this.deps.open(action);
  }

  begin(setup: BrowserSetup, endpointId: string, origin: string, revision: number) {
    this.revision(setup, revision);
    if (!setup.approvedBy || setup.state !== 'ready_for_verification') throw new Error('SETUP_NOT_READY');
    if (setup.configRevision !== browserConfigRevision(this.deps.getConfig())) throw new Error('CONFIG_CHANGED');
    if (setup.attempt && !setup.attempt.released) throw new Error('CONTROL_RELEASE_REQUIRED');
    if (!this.deps.canUseBrowser(setup.agentId)) throw new Error('AGENT_BROWSER_DENIED: Enable browser_use for this Agent and start a refreshed turn.');
    if (getBrowserTabBinding(setup.conversationId)) throw new Error('TAB_ALREADY_ATTACHED: Release the existing tab before starting this test.');
    const endpoint = this.endpoints().find(e => e.endpointId === endpointId);
    if (!endpoint) throw new Error('ENDPOINT_OFFLINE');
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_ORIGIN');
    const id = randomUUID();
    const marker = `XOPC-${randomUUID()}`;
    return saveBrowserSetup({ ...setup, state: 'verifying', error: undefined, attempt: {
      id, endpointId, principalId: endpoint.principalId, appVersion: endpoint.appVersion, policyRevision: this.policyRevision(setup.agentId),
      fixtureUrl: `${url.origin}/browser-setup-test.html#${marker}`, marker, sample: `Hello-${id.slice(0, 8)}`,
      sessionId: randomUUID(), expiresAt: Date.now() + VERIFY_MS, actions: 0, read: false, clicked: false, filled: false, released: false,
    } }, setup.revision);
  }

  cancel(setup: BrowserSetup) {
    if (setup.state === 'cancelled') return setup;
    return saveBrowserSetup({ ...setup, state: 'cancelled', approvedBy: undefined,
      error: setup.attempt && !setup.attempt.released ? 'CONTROL_RELEASE_REQUIRED: Close the verification browser session; cancellation does not prove release.' : undefined }, setup.revision);
  }

  async release(setup: BrowserSetup) {
    if (!setup.attempt || setup.attempt.released) return setup;
    const endpoint = this.endpoints().find(e => e.endpointId === setup.attempt!.endpointId);
    if (!endpoint || endpoint.principalId !== setup.attempt.principalId) throw new Error('ENDPOINT_OFFLINE: Control release cannot be confirmed.');
    const result = await this.deps.release(setup.attempt.endpointId, setup.attempt.sessionId!);
    return this.afterAction(setup.id, setup.attempt.id, { action: 'close' }, result) ?? readBrowserSetup(setup.id)!;
  }

  canRestoreSession(taskKey: string, sessionId: string): boolean {
    const [prefix, setupId, attemptId] = taskKey.split(':');
    if (prefix !== 'browser-setup' || !setupId) return false;
    const setup = readBrowserSetup(setupId);
    return Boolean(setup?.attempt?.id === attemptId && setup.attempt.sessionId === sessionId && !setup.attempt.released);
  }

  allowsVerificationUrl(taskKey: string, url: string): boolean {
    const [prefix, setupId, attemptId] = taskKey.split(':');
    if (prefix !== 'browser-setup' || !setupId) return false;
    const setup = readBrowserSetup(setupId);
    return Boolean(setup?.approvedBy && setup.state === 'verifying' && setup.attempt?.id === attemptId
      && setup.attempt.fixtureUrl === url && Date.now() <= setup.attempt.expiresAt
      && setup.configRevision === browserConfigRevision(this.deps.getConfig()));
  }

  /** Called only by the real Agent browser tool, before its normal runtime/policy path. */
  beforeAction(conversationId: string, agentId: string, input: BrowserActionInput) {
    let setup = findBrowserSetup(conversationId, agentId);
    if (setup?.attempt?.released && input.action === 'close' && input.sessionId === setup.attempt.sessionId) throw new Error('VERIFICATION_ALREADY_RELEASED');
    if (!setup?.attempt || setup.attempt.released || !['verifying', 'needs_attention', 'cancelled'].includes(setup.state)) return undefined;
    const a = setup.attempt;
    const closing = input.action === 'close';
    if (!closing) {
      if (setup.state !== 'verifying') throw new Error('VERIFICATION_STOPPED: Close the verification session first.');
      if (Date.now() > a.expiresAt || a.actions >= MAX_ACTIONS) throw new Error('VERIFICATION_BUDGET_EXCEEDED: Close the verification session.');
      if (setup.configRevision !== browserConfigRevision(this.deps.getConfig()) || a.policyRevision !== this.policyRevision(setup.agentId)) throw new Error('CONFIG_CHANGED: Close the verification session.');
      const endpoint = this.endpoints().find(e => e.endpointId === a.endpointId);
      if (!endpoint || endpoint.principalId !== a.principalId || endpoint.appVersion !== a.appVersion) throw new Error('ENDPOINT_CHANGED');
      const node = 'ref' in input ? a.observation?.nodes.find(n => n.ref === input.ref) : undefined;
      const allowed = input.action === 'navigate' ? !a.tabId && input.url === a.fixtureUrl
        : input.action === 'observe' ? Boolean(a.sessionId)
        : input.action === 'click' ? a.read && !a.clicked && node?.role === 'button' && node.name === 'Test click' && input.revision === a.observation?.revision
        : input.action === 'fill' ? a.clicked && !a.filled && node?.name === 'Test input' && input.value === a.sample && input.submit !== true && input.revision === a.observation?.revision
        : false;
      if (!allowed) throw new Error('VERIFICATION_ACTION_DENIED: Follow the test instructions using fresh observation refs.');
    }
    if (input.sessionId && input.sessionId !== a.sessionId) throw new Error('VERIFICATION_SESSION_MISMATCH');
    setup = saveBrowserSetup({ ...setup, attempt: { ...a, actions: a.actions + 1 } }, setup.revision);
    return { setupId: setup.id, attemptId: a.id, taskKey: `browser-setup:${setup.id}:${a.id}`,
      input: { ...input, ...(a.sessionId ? { sessionId: a.sessionId } : {}), target: { kind: 'endpoint' as const, endpointId: a.endpointId } } as BrowserActionInput };
  }

  afterAction(setupId: string, attemptId: string, input: BrowserActionInput, result: BrowserControlResult) {
    const setup = readBrowserSetup(setupId);
    if (!setup?.attempt || setup.attempt.id !== attemptId) return;
    const a = { ...setup.attempt };
    if (input.action === 'close' && result.ok && result.receipt.action === 'close' && result.receipt.verified) {
      a.released = true;
      delete a.observation;
      const complete = setup.state === 'verifying' && setup.configRevision === browserConfigRevision(this.deps.getConfig()) && Date.now() <= a.expiresAt && a.policyRevision === this.policyRevision(setup.agentId) && this.deps.canUseBrowser(setup.agentId) && a.read && a.clicked && a.filled;
      return saveBrowserSetup({ ...setup, attempt: a, state: setup.state === 'cancelled' ? 'cancelled' : complete ? 'completed' : 'needs_attention', error: complete || setup.state === 'cancelled' ? undefined : setup.error?.startsWith('BROWSER_CONTROL_REVOKED') ? setup.error : 'VERIFICATION_INCOMPLETE: Review the checks and start a new test.' }, setup.revision);
    }
    if ('error' in result) return saveBrowserSetup({ ...setup, state: setup.state === 'cancelled' ? 'cancelled' : 'needs_attention', error: result.error.message.includes('BROWSER_CONTROL_REVOKED') ? 'BROWSER_CONTROL_REVOKED: Chrome control was stopped by the user. Release the demo, then resume control in the extension before starting a new test.' : 'BROWSER_ACTION_FAILED: Close the verification session before retrying.' }, setup.revision);
    if (result.receipt.action !== input.action) return saveBrowserSetup({ ...setup, state: setup.state === 'cancelled' ? 'cancelled' : 'needs_attention', error: 'VERIFICATION_RECEIPT_MISMATCH: Release the demo session.' }, setup.revision);
    const o = result.receipt.observation;
    if (!o || !result.receipt.verified) return;
    if (o.url !== a.fixtureUrl || (a.tabId && o.tabId !== a.tabId) || (a.documentId && o.documentId !== a.documentId) || (a.sessionId && o.sessionId !== a.sessionId)) {
      return saveBrowserSetup({ ...setup, state: setup.state === 'cancelled' ? 'cancelled' : 'needs_attention', error: 'VERIFICATION_TARGET_CHANGED: Close the verification session.' }, setup.revision);
    }
    a.sessionId = o.sessionId; a.tabId = o.tabId; a.documentId = o.documentId;
    a.observation = { revision: o.revision, nodes: o.nodes.map(({ ref, role, name, value, states }) => ({ ref, role, name, value, states })) };
    const names = o.nodes.map(n => n.name);
    if (names.includes(`Read check: ${a.marker}`)) a.read = true;
    if (input.action === 'click' && names.includes(`Click passed: ${a.marker}`)) a.clicked = true;
    if (input.action === 'fill' && a.clicked && names.includes(`Input passed: ${a.sample}`)) a.filled = true;
    return saveBrowserSetup({ ...setup, attempt: a }, setup.revision);
  }
}
