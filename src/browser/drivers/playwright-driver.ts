import { randomUUID } from 'node:crypto';

import type {
  BrowserActionInput,
  BrowserControlError,
  BrowserControlResult,
  BrowserNavigateInput,
  BrowserNode,
  BrowserObservation,
  BrowserObserveInput,
  BrowserTab,
  BrowserTabsInput,
} from '@xopcai/browser-control-contract';
import type { Browser, BrowserContext, ElementHandle, Page } from 'playwright-core';

import { verifyBrowserExpectation } from '../verification/expectation.js';
import type { BrowserDriver, BrowserPrimitiveInput } from './browser-driver.js';

export interface PlaywrightConnection {
  browser: Browser;
  context: BrowserContext;
  release?: () => Promise<void>;
}

export interface PlaywrightDriverOptions {
  connect: () => Promise<PlaywrightConnection>;
  maxNodes: number;
  maxCharacters: number;
  visualFallback: boolean;
  actionTimeoutMs: number;
}

interface PageState {
  id: string;
  page: Page;
  documentId: string;
  documentMarker: string;
  revision: number;
  refs: Map<string, ElementHandle<any>>;
  lastNodes: BrowserNode[];
}

interface SessionState {
  activeTabId: string;
  tabs: Map<string, PageState>;
}

interface RawNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  states: string[];
  bounds?: { x: number; y: number; width: number; height: number };
}

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export class PlaywrightDriver implements BrowserDriver {
  readonly kind = 'playwright' as const;

  private connection: PlaywrightConnection | null = null;
  private sessions = new Map<string, SessionState>();

  constructor(private readonly options: PlaywrightDriverOptions) {}

  async connect(): Promise<void> {
    if (this.connection?.browser.isConnected()) return;
    this.connection = await this.options.connect();
  }

  async disconnect(): Promise<void> {
    for (const session of this.sessions.values()) {
      for (const state of session.tabs.values()) await state.page.close().catch(() => {});
    }
    this.sessions.clear();
    await this.connection?.release?.().catch(() => {});
    await this.connection?.context.close().catch(() => {});
    await this.connection?.browser.close().catch(() => {});
    this.connection = null;
  }

  async createSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return;
    await this.connect();
    const page = await this.context().newPage();
    const state = this.createPageState(page);
    this.sessions.set(sessionId, { activeTabId: state.id, tabs: new Map([[state.id, state]]) });
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const state of session.tabs.values()) await state.page.close().catch(() => {});
    this.sessions.delete(sessionId);
  }

  async navigate(sessionId: string, input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    const startedAt = Date.now();
    const state = await this.activeState(sessionId);
    try {
      throwIfAborted(signal);
      await state.page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: this.options.actionTimeoutMs });
      const observation = await this.observe(sessionId, { action: 'observe', visual: 'auto' }, signal);
      return this.verifiedResult(input, observation, startedAt, 'read');
    } catch (error) {
      return failureFrom(error);
    }
  }

  async observe(sessionId: string, input: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation> {
    throwIfAborted(signal);
    const state = await this.activeState(sessionId);
    const marker = await state.page.evaluate(() => {
      const root = globalThis as any;
      return `${root.location.href}|${root.performance.timeOrigin}`;
    });
    if (marker !== state.documentMarker) {
      state.documentMarker = marker;
      state.documentId = randomUUID();
      state.revision = 0;
      state.refs.clear();
      state.lastNodes = [];
    }

    const candidates = state.page.locator(INTERACTIVE_SELECTOR);
    const count = Math.min(await candidates.count(), this.options.maxNodes * 3);
    const nodes: BrowserNode[] = [];
    const refs = new Map<string, ElementHandle<any>>();
    let characters = 0;

    for (let index = 0; index < count && nodes.length < this.options.maxNodes; index += 1) {
      throwIfAborted(signal);
      const locator = candidates.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      const handle = await locator.elementHandle() as ElementHandle<any> | null;
      if (!handle) continue;
      let raw = await handle.evaluate((element: any, elementIndex) => {
        const html = element as any;
        const tag = element.tagName.toLowerCase();
        const input = element as any;
        const explicitRole = element.getAttribute('role');
        const implicitRole = tag === 'a' ? 'link'
          : tag === 'button' ? 'button'
          : tag === 'select' ? 'combobox'
          : tag === 'textarea' ? 'textbox'
          : tag === 'summary' ? 'button'
          : tag === 'input' && input.type === 'checkbox' ? 'checkbox'
          : tag === 'input' && input.type === 'radio' ? 'radio'
          : tag === 'input' ? 'textbox'
          : 'interactive';
        const label = tag === 'input' || tag === 'textarea' || tag === 'select'
          ? (input.labels?.[0]?.innerText ?? '')
          : '';
        const name = element.getAttribute('aria-label')
          || label
          || element.getAttribute('alt')
          || element.getAttribute('placeholder')
          || html.innerText
          || element.getAttribute('title')
          || '';
        const rect = element.getBoundingClientRect();
        const root = globalThis as typeof globalThis & { __xopcRefCounter?: number };
        root.__xopcRefCounter = (root.__xopcRefCounter ?? 0) + 1;
        const existing = element.getAttribute('data-xopc-ref');
        const ref = existing && /^xopc-e\d+$/.test(existing) ? existing : `xopc-e${root.__xopcRefCounter}`;
        if (ref !== existing) element.setAttribute('data-xopc-ref', ref);
        const states: string[] = [];
        const autocomplete = element.getAttribute('autocomplete')?.toLowerCase() ?? '';
        const sensitive = input.type === 'password' || /^(cc-|one-time-code$|transaction-)/.test(autocomplete);
        if ((element as any).disabled) states.push('disabled');
        if ((element as any).checked) states.push('checked');
        if ((globalThis as any).document.activeElement === element) states.push('focused');
        if (element.getAttribute('aria-expanded') === 'true') states.push('expanded');
        if (sensitive) states.push('sensitive');
        if ((tag === 'button' || tag === 'input') && input.type === 'submit') states.push('submit');
        return {
          ref,
          role: explicitRole || implicitRole,
          name: name.trim().replace(/\s+/g, ' ').slice(0, 240),
          value: !sensitive && 'value' in element ? String((element as any).value ?? '').slice(0, 500) : undefined,
          description: element.getAttribute('aria-description') ?? undefined,
          states,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          elementIndex,
        } satisfies RawNode & { elementIndex: number };
      }, index);
      if (refs.has(raw.ref)) {
        const ref = `xopc-e${Date.now()}${index}`;
        await handle.evaluate((element, nextRef) => element.setAttribute('data-xopc-ref', nextRef), ref);
        raw = { ...raw, ref };
      }
      characters += raw.name.length + (raw.value?.length ?? 0) + (raw.description?.length ?? 0);
      if (characters > this.options.maxCharacters) break;
      const node: BrowserNode = raw;
      nodes.push(node);
      refs.set(node.ref, handle);
    }

    state.revision += 1;
    state.refs = refs;
    const changes = diffNodes(state.lastNodes, nodes);
    state.lastNodes = nodes;
    const focused = nodes.find((node) => node.states.includes('focused'))?.ref;
    const visual = await this.captureVisual(state.page, input.visual ?? 'auto', nodes.length);
    return {
      sessionId,
      tabId: state.id,
      revision: state.revision,
      documentId: state.documentId,
      url: state.page.url(),
      title: await state.page.title().catch(() => ''),
      focused,
      nodes,
      changes,
      visual,
    };
  }

  async perform(sessionId: string, input: BrowserPrimitiveInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    const startedAt = Date.now();
    try {
      throwIfAborted(signal);
      const state = await this.activeState(sessionId);
      if ('revision' in input && input.revision !== state.revision) {
        return stale(await this.observe(sessionId, { action: 'observe', visual: 'never' }, signal));
      }
      const handle = 'ref' in input && input.ref ? state.refs.get(input.ref) : undefined;
      if ('ref' in input && input.ref && !handle) return targetNotFound(input.ref);

      switch (input.action) {
        case 'click':
          await handle!.click({ timeout: this.options.actionTimeoutMs });
          break;
        case 'fill':
          await handle!.fill(input.value, { timeout: this.options.actionTimeoutMs });
          if (input.submit) await handle!.press('Enter');
          break;
        case 'select':
          await handle!.selectOption(input.value);
          break;
        case 'press':
          if (handle) await handle.press(input.key);
          else await state.page.keyboard.press(input.key);
          break;
        case 'scroll':
          if (handle) await handle.evaluate((element, deltaY) => element.scrollBy({ top: deltaY }), input.deltaY);
          else await state.page.mouse.wheel(0, input.deltaY);
          break;
        case 'wait':
          await this.wait(state, input, signal);
          break;
        case 'upload':
          await handle!.setInputFiles(input.paths);
          break;
      }

      await state.page.waitForTimeout(200);
      const observation = await this.observe(sessionId, { action: 'observe', visual: 'auto' }, signal);
      return this.verifiedResult(input, observation, startedAt, 'draft');
    } catch (error) {
      return failureFrom(error);
    }
  }

  async tabs(sessionId: string, input: BrowserTabsInput, signal?: AbortSignal): Promise<BrowserControlResult> {
    const startedAt = Date.now();
    try {
      throwIfAborted(signal);
      const session = await this.session(sessionId);
      if (input.operation === 'create') {
        const page = await this.context().newPage();
        const state = this.createPageState(page);
        session.tabs.set(state.id, state);
        session.activeTabId = state.id;
        if (input.url) await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: this.options.actionTimeoutMs });
      } else if (input.operation === 'activate') {
        if (!input.tabId || !session.tabs.has(input.tabId)) return targetNotFound(input.tabId ?? '');
        session.activeTabId = input.tabId;
        await session.tabs.get(input.tabId)!.page.bringToFront();
      } else if (input.operation === 'close') {
        if (!input.tabId || !session.tabs.has(input.tabId)) return targetNotFound(input.tabId ?? '');
        const target = session.tabs.get(input.tabId)!;
        await target.page.close();
        session.tabs.delete(input.tabId);
        if (session.tabs.size === 0) {
          const next = this.createPageState(await this.context().newPage());
          session.tabs.set(next.id, next);
        }
        session.activeTabId = session.tabs.keys().next().value as string;
      }
      const tabs = await this.listTabs(session);
      return { ok: true, receipt: { action: 'tabs', risk: 'read', durationMs: Date.now() - startedAt, verified: true, tabs } };
    } catch (error) {
      return failureFrom(error);
    }
  }

  private async wait(state: PageState, input: Extract<BrowserPrimitiveInput, { action: 'wait' }>, signal?: AbortSignal): Promise<void> {
    const timeout = input.timeoutMs ?? this.options.actionTimeoutMs;
    if (input.condition === 'page_idle') {
      await state.page.waitForLoadState('networkidle', { timeout });
      return;
    }
    if (input.condition === 'text') {
      if (!input.value) throw new Error('wait text requires value');
      await state.page.getByText(input.value, { exact: false }).first().waitFor({ state: 'visible', timeout });
      return;
    }
    if (!input.ref) throw new Error(`wait ${input.condition} requires ref`);
    const handle = state.refs.get(input.ref);
    if (!handle && input.condition === 'hidden') return;
    if (!handle) throw new Error(`Target ${input.ref} was not found`);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const visible = await handle.isVisible().catch(() => false);
      if ((input.condition === 'visible' && visible) || (input.condition === 'hidden' && !visible)) return;
      await state.page.waitForTimeout(100);
    }
    throw new Error(`Timed out waiting for ${input.ref} to become ${input.condition}`);
  }

  private verifiedResult(
    input: BrowserActionInput,
    observation: BrowserObservation,
    startedAt: number,
    risk: 'read' | 'draft',
  ): BrowserControlResult {
    const expectation = 'expect' in input ? input.expect : undefined;
    const failed = verifyBrowserExpectation(expectation, observation);
    if (failed) return { ok: false, error: { code: 'EXPECTATION_FAILED', message: failed, observation } };
    return {
      ok: true,
      receipt: { action: input.action, risk, durationMs: Date.now() - startedAt, verified: true, observation },
    };
  }

  private async captureVisual(page: Page, mode: BrowserObserveInput['visual'], nodeCount: number) {
    if (mode === 'never') return undefined;
    const visualPage = mode === 'always' || (this.options.visualFallback && (
      nodeCount === 0
      || await page.locator('canvas,embed[type="application/pdf"],object[type="application/pdf"]').count() > 0
    ));
    if (!visualPage) return undefined;
    const data = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false, scale: 'css' });
    const viewport = page.viewportSize();
    return {
      mimeType: 'image/jpeg' as const,
      data: data.toString('base64'),
      width: viewport?.width,
      height: viewport?.height,
    };
  }

  private async activeState(sessionId: string): Promise<PageState> {
    const session = await this.session(sessionId);
    const state = session.tabs.get(session.activeTabId);
    if (!state) throw new Error(`Active tab is missing for session ${sessionId}`);
    return state;
  }

  private async session(sessionId: string): Promise<SessionState> {
    await this.createSession(sessionId);
    return this.sessions.get(sessionId)!;
  }

  private createPageState(page: Page): PageState {
    return {
      id: `tab_${randomUUID()}`,
      page,
      documentId: randomUUID(),
      documentMarker: '',
      revision: 0,
      refs: new Map(),
      lastNodes: [],
    };
  }

  private context(): BrowserContext {
    if (!this.connection) throw new Error('Playwright driver is not connected');
    return this.connection.context;
  }

  private async listTabs(session: SessionState): Promise<BrowserTab[]> {
    return Promise.all([...session.tabs.values()].map(async (state) => ({
      id: state.id,
      url: state.page.url(),
      title: await state.page.title().catch(() => ''),
      active: state.id === session.activeTabId,
    })));
  }
}

function diffNodes(previous: BrowserNode[], next: BrowserNode[]) {
  const before = new Map(previous.map((node) => [node.ref, node]));
  const after = new Map(next.map((node) => [node.ref, node]));
  const added = next.filter((node) => !before.has(node.ref));
  const changed = next.filter((node) => {
    const old = before.get(node.ref);
    return old && JSON.stringify(old) !== JSON.stringify(node);
  });
  const removed = previous.filter((node) => !after.has(node.ref)).map((node) => node.ref);
  return { added, changed, removed };
}

function stale(observation: BrowserObservation): BrowserControlResult {
  return { ok: false, error: { code: 'STALE_OBSERVATION', message: 'The page changed. Use the attached observation and retry with its revision.', observation } };
}

function targetNotFound(ref: string): BrowserControlResult {
  return { ok: false, error: { code: 'TARGET_NOT_FOUND', message: `Target ${ref || '(missing)'} was not found.` } };
}

function failureFrom(error: unknown): BrowserControlResult {
  const message = error instanceof Error ? error.message : String(error);
  const code: BrowserControlError['code'] = /aborted/i.test(message) ? 'ABORTED' : /timeout|timed out/i.test(message) ? 'TIMEOUT' : 'DRIVER_UNAVAILABLE';
  return { ok: false, error: { code, message } };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Operation was aborted');
}
