import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import type {
  BrowserActionInput,
  BrowserControlResult,
  BrowserObservation,
  BrowserRiskLevel,
  BrowserSequenceInput,
  BrowserTarget,
} from '@xopcai/browser-control-contract';

import type { Config } from '../../config/schema.js';
import { checkPostRedirectUrl, assertBrowserUrlAllowed, containsApiKeyPattern } from '../url-policy.js';
import type { BrowserDriver, BrowserPrimitiveInput } from '../drivers/browser-driver.js';
import { createBrowserApproval, consumeBrowserApproval } from '../policy/approval-store.js';
import { browserRiskNeedsApproval, classifyBrowserRisk } from '../policy/browser-policy.js';

export interface BrowserRuntimeOptions {
  getConfig: () => Config['browser'];
  createDriver: () => Promise<BrowserDriver>;
  allowedUploadRoots?: string[];
  emit?: (type: string, payload: unknown) => void;
  resolveTarget?: (taskKey: string) => BrowserTarget | undefined;
}

interface RuntimeSession {
  id: string;
  taskKey: string;
  observation?: BrowserObservation;
  lastUsedAt: number;
}

export class BrowserRuntime {
  private driver: BrowserDriver | null = null;
  private sessionsByTask = new Map<string, RuntimeSession>();

  constructor(private readonly options: BrowserRuntimeOptions) {}

  async execute(taskKey: string, input: BrowserActionInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    this.evictExpiredSessions();
    if (!this.options.getConfig().enabled) return failure('DRIVER_UNAVAILABLE', 'Browser Control is disabled.');
    if (signal?.aborted) return failure('ABORTED', 'Operation was aborted.');
    const resolvedTarget = input.target ? undefined : this.options.resolveTarget?.(taskKey);
    const effectiveInput = input.target || !resolvedTarget ? input : { ...input, target: resolvedTarget };
    let session: RuntimeSession | null;
    let driver: BrowserDriver;
    try {
      session = await this.resolveSession(taskKey, effectiveInput.sessionId);
      if (!session) return failure('SESSION_NOT_FOUND', 'The browser session does not belong to this task.');
      driver = await this.getDriver();
    } catch (error) {
      return failure('DRIVER_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    }
    session.lastUsedAt = Date.now();

    this.options.emit?.('browser.action.started', { sessionId: session.id, action: input.action });
    let result: BrowserControlResult;
    try {
      result = await this.dispatch(driver, session, effectiveInput, signal);
      result = this.constrainResult(result);
    } catch (error) {
      result = failure('DRIVER_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    }

    if (result.ok) {
      if (result.receipt.observation) session.observation = result.receipt.observation;
      this.options.emit?.('browser.action.completed', { sessionId: session.id, receipt: withoutVisual(result.receipt) });
      if (result.receipt.observation) {
        this.options.emit?.('browser.observation.created', withoutVisual(result.receipt.observation));
      }
    } else if ('error' in result) {
      if (result.error.observation) session.observation = result.error.observation;
      this.options.emit?.('browser.session.failed', { sessionId: session.id, error: result.error });
    }
    return result;
  }

  async shutdown(): Promise<void> {
    await this.driver?.disconnect();
    this.driver = null;
    this.sessionsByTask.clear();
  }

  async closeTaskSession(taskKey: string): Promise<void> {
    const session = this.sessionsByTask.get(taskKey);
    if (!session) return;
    await this.driver?.closeSession(session.id);
    this.sessionsByTask.delete(taskKey);
    this.options.emit?.('browser.session.closed', { sessionId: session.id });
  }

  private async dispatch(
    driver: BrowserDriver,
    session: RuntimeSession,
    input: BrowserActionInput,
    signal?: AbortSignal,
  ): Promise<BrowserControlResult> {
    if (input.action === 'close') {
      await this.closeTaskSession(session.taskKey);
      return { ok: true, receipt: { action: 'close', risk: 'read', durationMs: 0, verified: true } };
    }
    if (input.action === 'observe') {
      const observation = await driver.observe(session.id, input, signal);
      return { ok: true, receipt: { action: 'observe', risk: 'read', durationMs: 0, verified: true, observation } };
    }
    if (input.action === 'navigate') {
      const blocked = this.validateUrl(input.url);
      if (blocked) return failure('BLOCKED_URL', blocked);
      const crossDomainPolicy = this.crossDomainPolicy(session.observation?.url, input.url);
      if (crossDomainPolicy === 'deny') return failure('BLOCKED_URL', 'Cross-domain navigation is denied by policy.');
      const authorization = this.authorize(
        session.taskKey,
        input,
        crossDomainPolicy === 'ask' ? 'external_effect' : 'read',
        crossDomainPolicy,
      );
      if (authorization) return authorization;
      const result = await driver.navigate(session.id, input, signal);
      return this.validateRedirect(input.url, result);
    }
    if (input.action === 'tabs') {
      if (input.url) {
        const blocked = this.validateUrl(input.url);
        if (blocked) return failure('BLOCKED_URL', blocked);
        const crossDomainPolicy = this.crossDomainPolicy(session.observation?.url, input.url);
        if (crossDomainPolicy === 'deny') return failure('BLOCKED_URL', 'Cross-domain navigation is denied by policy.');
        const authorization = this.authorize(
          session.taskKey,
          input,
          crossDomainPolicy === 'ask' ? 'external_effect' : 'read',
          crossDomainPolicy,
        );
        if (authorization) return authorization;
      }
      const result = await driver.tabs(session.id, input, signal);
      if (!input.url || !result.ok) return result;
      const finalUrl = result.receipt.tabs?.find((tab) => tab.active)?.url;
      const blocked = finalUrl ? this.blockedRedirect(finalUrl) : 'The created tab did not report its final URL.';
      return blocked ? failure('BLOCKED_URL', blocked) : result;
    }
    if (input.action === 'sequence') return this.executeSequence(driver, session, input, signal);

    const target = findActionTarget(input, session.observation);
    const risk = classifyBrowserRisk(input, target);
    if (input.action === 'upload') {
      const invalidPath = this.invalidUploadPath(input.paths);
      if (invalidPath) return failure('INVALID_INPUT', invalidPath);
    }
    const authorization = this.authorize(session.taskKey, input, risk, undefined, target);
    if (authorization) return authorization;
    const result = await driver.perform(session.id, input, signal);
    return withRisk(result, risk);
  }

  private async executeSequence(
    driver: BrowserDriver,
    session: RuntimeSession,
    input: BrowserSequenceInput,
    signal?: AbortSignal,
  ): Promise<BrowserControlResult> {
    const config = this.options.getConfig();
    if (input.steps.length === 0 || input.steps.length > config.limits.maxSequenceLength) {
      return failure('INVALID_INPUT', `Sequence length must be between 1 and ${config.limits.maxSequenceLength}.`);
    }
    const initialDocument = session.observation?.documentId;
    let revision = input.revision;
    let last: BrowserControlResult | undefined;
    let highestRisk: BrowserRiskLevel = 'draft';
    for (const step of input.steps) {
      const target = findActionTarget(step as BrowserActionInput, session.observation);
      const risk = classifyBrowserRisk(step as BrowserActionInput, target);
      if (riskRank(risk) > riskRank(highestRisk)) highestRisk = risk;
    }
    const authorization = this.authorize(session.taskKey, input, highestRisk);
    if (authorization) return authorization;

    for (const step of input.steps) {
      const primitive = { ...step, sessionId: session.id, revision } as BrowserPrimitiveInput;
      last = await driver.perform(session.id, primitive, signal);
      if (!last.ok) return last;
      const observation = last.receipt.observation;
      if (observation) {
        session.observation = observation;
        revision = observation.revision;
        if (initialDocument && observation.documentId !== initialDocument) {
          return failure('STALE_OBSERVATION', 'Sequence stopped because navigation replaced the document.', observation);
        }
      }
    }
    if (!last?.ok) return failure('INVALID_INPUT', 'Sequence did not execute.');
    return {
      ok: true,
      receipt: { ...last.receipt, action: 'sequence', risk: highestRisk },
    };
  }

  private authorize(
    sessionKey: string,
    input: BrowserActionInput,
    risk: BrowserRiskLevel,
    explicitPolicy?: 'allow' | 'ask' | 'deny',
    target?: BrowserObservation['nodes'][number],
  ): BrowserControlResult | null {
    const security = this.options.getConfig().security;
    const policy = explicitPolicy ?? (input.action === 'upload' ? security.uploads : security.consequentialActions);
    if (!browserRiskNeedsApproval(risk) || policy === 'allow') return null;
    if (policy === 'deny') return failure('APPROVAL_REQUIRED', `Browser action is denied by policy (${risk}).`);
    if (consumeBrowserApproval(input.approvalId, sessionKey, input)) return null;
    const approval = createBrowserApproval(sessionKey, input, risk, browserApprovalSummary(input, target));
    this.options.emit?.('browser.approval.required', approval);
    return {
      ok: false,
      error: {
        code: 'APPROVAL_REQUIRED',
        message: 'This browser action needs local-owner approval before it can run.',
        approval: { id: approval.id, risk, summary: approval.summary, expiresAt: approval.expiresAt },
      },
    };
  }

  private validateUrl(url: string): string | null {
    if (containsApiKeyPattern(url)) return 'URL contains a credential-like value.';
    try {
      const host = new URL(url).hostname.toLowerCase();
      const allowed = this.options.getConfig().security.allowedPrivateHosts
        .some((candidate) => candidate.toLowerCase() === host);
      assertBrowserUrlAllowed(url, { privateHostAllowed: allowed });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private validateRedirect(requestedUrl: string, result: BrowserControlResult): BrowserControlResult {
    if (!result.ok || !result.receipt.observation) return result;
    const finalUrl = result.receipt.observation.url;
    if (finalUrl === requestedUrl) return result;
    const blocked = this.blockedRedirect(finalUrl);
    return blocked ? failure('BLOCKED_URL', blocked, result.receipt.observation) : result;
  }

  private blockedRedirect(finalUrl: string): string | undefined {
    try {
      const host = new URL(finalUrl).hostname.toLowerCase();
      const allowed = this.options.getConfig().security.allowedPrivateHosts
        .some((candidate) => candidate.toLowerCase() === host);
      return checkPostRedirectUrl(finalUrl, { privateHostAllowed: allowed });
    } catch {
      return 'Browser returned an invalid final URL.';
    }
  }

  private crossDomainPolicy(currentUrl: string | undefined, nextUrl: string): 'allow' | 'ask' | 'deny' {
    if (!currentUrl || currentUrl === 'about:blank') return 'allow';
    try {
      if (new URL(currentUrl).hostname === new URL(nextUrl).hostname) return 'allow';
    } catch {
      return 'allow';
    }
    return this.options.getConfig().security.crossDomainNavigation;
  }

  private invalidUploadPath(paths: string[]): string | null {
    const roots = this.options.allowedUploadRoots ?? [];
    if (roots.length === 0) return 'File uploads are unavailable because no upload root is configured.';
    const normalizedRoots = roots.map((root) => resolve(root));
    const invalid = paths.find((path) => {
      if (!isAbsolute(path)) return true;
      const absolute = resolve(path);
      return !normalizedRoots.some((root) => {
        const child = relative(root, absolute);
        return child === '' || (!child.startsWith('..') && !isAbsolute(child));
      });
    });
    return invalid ? `Upload path is outside the allowed workspace: ${invalid}` : null;
  }

  private async resolveSession(taskKey: string, requestedId?: string): Promise<RuntimeSession | null> {
    const existing = this.sessionsByTask.get(taskKey);
    if (existing) return !requestedId || requestedId === existing.id ? existing : null;
    if (requestedId) return null;
    const session = { id: randomUUID(), taskKey, lastUsedAt: Date.now() };
    const driver = await this.getDriver();
    await driver.createSession(session.id);
    this.sessionsByTask.set(taskKey, session);
    this.options.emit?.('browser.session.started', { sessionId: session.id, taskKey, driver: driver.kind });
    return session;
  }

  private async getDriver(): Promise<BrowserDriver> {
    if (this.driver) return this.driver;
    this.driver = await this.options.createDriver();
    await this.driver.connect();
    return this.driver;
  }

  private constrainResult(result: BrowserControlResult): BrowserControlResult {
    const observation = 'error' in result ? result.error.observation : result.receipt.observation;
    if (!observation) return result;
    const { maxNodes, maxCharacters } = this.options.getConfig().observation;
    const nodes = [] as BrowserObservation['nodes'];
    let characters = 0;
    for (const node of observation.nodes.slice(0, maxNodes)) {
      const size = node.name.length + (node.value?.length ?? 0) + (node.description?.length ?? 0);
      if (characters + size > maxCharacters) break;
      characters += size;
      nodes.push(node);
    }
    if (nodes.length === observation.nodes.length) return result;
    const refs = new Set(nodes.map((node) => node.ref));
    const constrained = {
      ...observation,
      nodes,
      changes: {
        added: observation.changes.added.filter((node) => refs.has(node.ref)),
        changed: observation.changes.changed.filter((node) => refs.has(node.ref)),
        removed: observation.changes.removed,
      },
    };
    return 'error' in result
      ? { ok: false, error: { ...result.error, observation: constrained } }
      : { ok: true, receipt: { ...result.receipt, observation: constrained } };
  }

  private evictExpiredSessions(): void {
    const expiresBefore = Date.now() - this.options.getConfig().limits.sessionTimeoutMs;
    for (const [taskKey, session] of this.sessionsByTask) {
      if (session.lastUsedAt >= expiresBefore) continue;
      void this.driver?.closeSession(session.id).catch(() => {});
      this.sessionsByTask.delete(taskKey);
    }
  }
}

function failure(
  code: Extract<BrowserControlResult, { ok: false }>['error']['code'],
  message: string,
  observation?: BrowserObservation,
): BrowserControlResult {
  return { ok: false, error: { code, message, observation } };
}

function withRisk(result: BrowserControlResult, risk: BrowserRiskLevel): BrowserControlResult {
  return result.ok ? { ok: true, receipt: { ...result.receipt, risk } } : result;
}

function riskRank(risk: BrowserRiskLevel): number {
  return ['read', 'draft', 'external_effect', 'destructive', 'sensitive'].indexOf(risk);
}

function findActionTarget(
  input: BrowserActionInput,
  observation: BrowserObservation | undefined,
): BrowserObservation['nodes'][number] | undefined {
  const ref = 'ref' in input && input.ref
    ? input.ref
    : input.action === 'press'
      ? observation?.focused
      : undefined;
  return ref ? observation?.nodes.find((node) => node.ref === ref) : undefined;
}

function browserApprovalSummary(
  input: BrowserActionInput,
  target: BrowserObservation['nodes'][number] | undefined,
): string {
  const targetName = target?.name.trim() ? ` “${target.name.slice(0, 120)}”` : '';
  switch (input.action) {
    case 'navigate':
      return `Navigate to ${safeUrlLabel(input.url)}.`;
    case 'tabs':
      return input.url ? `Open a tab at ${safeUrlLabel(input.url)}.` : `Change browser tabs (${input.operation}).`;
    case 'click':
      return `Click${targetName || ` element ${input.ref}`}.`;
    case 'fill':
      return `${target?.states.includes('sensitive') ? 'Fill a sensitive field' : 'Fill field'}${targetName || ` ${input.ref}`}${input.submit ? ' and submit the form' : ''}.`;
    case 'upload':
      return `Upload ${input.paths.length} file${input.paths.length === 1 ? '' : 's'}${targetName ? ` using${targetName}` : ''}.`;
    case 'press':
      return `Press ${input.key}${targetName ? ` on${targetName}` : ''}.`;
    case 'sequence':
      return `Run ${input.steps.length} browser actions as one sequence.`;
    default:
      return `Run browser action “${input.action}”${targetName ? ` on${targetName}` : ''}.`;
  }
}

function safeUrlLabel(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, 240);
  } catch {
    return 'the requested URL';
  }
}

function withoutVisual<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value, (key, child) => key === 'visual' ? undefined : child)) as T;
}
