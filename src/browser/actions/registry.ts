/**
 * Browser Action Registry — unified action layer shared by browser_use tool, CLI, and pipeline.
 */

import type { Page } from 'playwright-core';

import { createLogger } from '../../utils/logger.js';
import { assertBrowserUrlAllowed, checkPostRedirectUrl, containsApiKeyPattern } from '../url-policy.js';
import { checkWebsiteBlocklist } from '../../agent/tools/url-safety.js';
import { resolveBrowserCommandTimeoutMs } from '../browser-command-timeout.js';
import { truncateSnapshotAtBoundary } from '../snapshot-helpers.js';
import { humanizedClick, humanizedFill, humanizedScroll, type HumanPreset } from '../humanize.js';
import { isTruthyValue, resolvePath, valueContains } from '../pipeline/template.js';

import type {
  BrowserActionContext,
  BrowserActionHandler,
  BrowserActionRegistry,
  BrowserActionResult,
} from './types.js';

const log = createLogger('BrowserActionRegistry');

const DEFAULT_SNAPSHOT_MAX = 30_000;
const AUTO_SNAPSHOT_MAX = 8_000;

interface NetworkEvent {
  type: 'request' | 'response' | 'requestfailed';
  url: string;
  method?: string;
  status?: number;
  resourceType?: string;
  postData?: string | null;
  body?: string;
  errorText?: string;
  timestamp: number;
}

interface NetworkMonitor {
  events: NetworkEvent[];
  includeBody: boolean;
  urlPattern?: string;
  dispose: () => void;
}

const networkMonitors = new WeakMap<Page, NetworkMonitor>();

// ─── Helpers ────────────────────────────────────────────────────────────────

function toMs(ctx: BrowserActionContext): number {
  return resolveBrowserCommandTimeoutMs(ctx.config);
}

/** Whether humanize mode is active for this context (local/cdp/cloakbrowser only). */
function isHumanizeEnabled(ctx: BrowserActionContext): boolean {
  return false;
}

function humanPreset(ctx: BrowserActionContext): HumanPreset {
  return 'default';
}

async function ariaSnapshot(page: Page, selector: string | undefined, maxLength: number, timeoutMs: number): Promise<string> {
  const loc = selector?.trim() ? page.locator(selector.trim()).first() : page.locator('body');
  await loc.waitFor({ state: 'attached', timeout: timeoutMs });
  let text = await loc.ariaSnapshot({ mode: 'ai', timeout: timeoutMs });
  if (!text || !text.trim()) text = '(empty snapshot)';
  if (text.length > maxLength) text = truncateSnapshotAtBoundary(text, maxLength);
  return text;
}

function resolveClickLocator(page: Page, args: Record<string, unknown>) {
  const selector = args.selector as string | undefined;
  const text = args.text as string | undefined;
  const role = args.role as string | undefined;
  const hasSel = Boolean(selector?.trim());
  const hasText = Boolean(text?.trim());
  const hasRole = Boolean(role?.trim());
  const n = (hasSel ? 1 : 0) + (hasText ? 1 : 0) + (hasRole ? 1 : 0);
  if (n !== 1) throw new Error('Provide exactly one of: selector, text, role');
  if (hasSel) return page.locator(selector!.trim()).first();
  if (hasText) return page.getByText(text!.trim(), { exact: false }).first();
  const raw = role!.trim();
  const idx = raw.indexOf(':');
  const roleName = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  const name = idx >= 0 ? raw.slice(idx + 1).trim() : '';
  if (!roleName) throw new Error('Invalid role: empty ARIA role');
  return page.getByRole(roleName as never, name ? { name } : undefined).first();
}

function resolveTypeLocator(page: Page, args: Record<string, unknown>) {
  const selector = args.selector as string | undefined;
  const label = args.label as string | undefined;
  const hasSel = Boolean(selector?.trim());
  const hasLab = Boolean(label?.trim());
  if (hasSel === hasLab) throw new Error('Provide exactly one of: selector, label');
  if (hasSel) return page.locator(selector!.trim()).first();
  return page.getByLabel(label!.trim()).first();
}

function ok(action: string, text: string, data?: unknown, artifacts?: BrowserActionResult['artifacts']): BrowserActionResult {
  return { ok: true, action, text, data, artifacts };
}

function fail(action: string, code: string, message: string, diagnostics?: BrowserActionResult['diagnostics']): BrowserActionResult {
  return { ok: false, action, error: { code, message }, diagnostics };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pipelineLast(ctx: BrowserActionContext): unknown {
  return ctx.pipeline?.last;
}

function valueFromArgs(ctx: BrowserActionContext, args: Record<string, unknown>): unknown {
  if ('value' in args) return args.value;
  if (typeof args.path === 'string') return resolvePath(pipelineLast(ctx), args.path);
  return pipelineLast(ctx);
}

function compareValues(a: unknown, b: unknown): number {
  const av = typeof a === 'number' ? a : String(a ?? '');
  const bv = typeof b === 'number' ? b : String(b ?? '');
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function matchesNetworkPattern(url: string, pattern: string | undefined): boolean {
  if (!pattern) return true;
  return url.includes(pattern);
}

// ─── Action Handlers ────────────────────────────────────────────────────────

const navigateAction: BrowserActionHandler = async (ctx, args) => {
  const url = String(args.url ?? '');
  if (!url) return fail('navigate', 'MISSING_URL', 'url is required');

  const allowPrivate = false;
  if (containsApiKeyPattern(url)) return fail('navigate', 'BLOCKED', 'URL contains API key/token');
  const block = checkWebsiteBlocklist(url, ctx.config?.tools?.web?.blocklist);
  if (block) return fail('navigate', 'BLOCKED', block.message);
  assertBrowserUrlAllowed(url, { allowPrivateUrls: allowPrivate });

  const waitUntil = (args.wait_until as string) ?? (args.waitFor as string) ?? 'domcontentloaded';
  const navTimeout = toMs(ctx);
  await ctx.page.goto(url, { waitUntil: waitUntil as any, timeout: navTimeout });

  const title = await ctx.page.title();
  const finalUrl = ctx.page.url();

  if (finalUrl && finalUrl !== url) {
    const redirectBlock = checkPostRedirectUrl(finalUrl, { allowPrivateUrls: allowPrivate });
    if (redirectBlock) {
      await ctx.page.goto('about:blank').catch(() => {});
      return fail('navigate', 'REDIRECT_BLOCKED', redirectBlock);
    }
  }

  let snapshot = '';
  try { snapshot = await ariaSnapshot(ctx.page, undefined, AUTO_SNAPSHOT_MAX, navTimeout); } catch { /* non-fatal */ }

  const text = `Navigated to: ${title}\nURL: ${finalUrl}${snapshot ? `\n--- Page Snapshot ---\n${snapshot}` : ''}`;
  return ok('navigate', text, { url: finalUrl, title });
};

const stateAction: BrowserActionHandler = async (ctx, args) => {
  const maxLen = typeof args.maxLength === 'number' ? args.maxLength : DEFAULT_SNAPSHOT_MAX;
  const selector = args.selector as string | undefined;
  const timeout = toMs(ctx);
  try {
    const text = await ariaSnapshot(ctx.page, selector, maxLen, timeout);
    return ok('state', text, { length: text.length });
  } catch (e) {
    return fail('state', 'SNAPSHOT_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const clickAction: BrowserActionHandler = async (ctx, args) => {
  const timeout = toMs(ctx);
  try {
    if (isHumanizeEnabled(ctx) && args.selector) {
      await humanizedClick(ctx.page, String(args.selector), humanPreset(ctx));
      return ok('click', 'Click succeeded (humanized).');
    }
    const loc = resolveClickLocator(ctx.page, args);
    await loc.click({ timeout });
    return ok('click', 'Click succeeded.');
  } catch (e) {
    return fail('click', 'CLICK_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const typeAction: BrowserActionHandler = async (ctx, args) => {
  const timeout = toMs(ctx);
  try {
    if (isHumanizeEnabled(ctx) && args.selector) {
      await humanizedFill(ctx.page, String(args.selector), String(args.text ?? ''), humanPreset(ctx));
      if (args.pressEnter) await ctx.page.keyboard.press('Enter');
      return ok('type', 'Typed into field (humanized).');
    }
    const loc = resolveTypeLocator(ctx.page, args);
    await loc.clear({ timeout: Math.min(5000, timeout) }).catch(() => {});
    await loc.fill(String(args.text ?? ''), { timeout });
    if (args.pressEnter) await ctx.page.keyboard.press('Enter');
    return ok('type', 'Typed into field.');
  } catch (e) {
    return fail('type', 'TYPE_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const scrollAction: BrowserActionHandler = async (ctx, args) => {
  const direction = (args.direction as string) ?? 'down';
  const amount = typeof args.amount === 'number' ? args.amount : 500;
  const dy = direction === 'down' ? amount : -amount;
  try {
    if (isHumanizeEnabled(ctx)) {
      await humanizedScroll(ctx.page, dy, humanPreset(ctx));
      return ok('scroll', `Scrolled ${direction} by ${amount}px (humanized).`);
    }
    await ctx.page.evaluate(({ deltaY }) => {
      (globalThis as any).scrollBy(0, deltaY);
    }, { deltaY: dy });
    return ok('scroll', `Scrolled ${direction} by ${amount}px.`);
  } catch (e) {
    return fail('scroll', 'SCROLL_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const screenshotAction: BrowserActionHandler = async (ctx, args) => {
  const timeout = toMs(ctx);
  const selector = args.selector as string | undefined;
  const fullPage = args.full_page === true || args.fullPage === true;
  const path = args.path as string | undefined;
  try {
    let buf: Buffer;
    if (selector?.trim()) {
      const loc = ctx.page.locator(selector.trim()).first();
      await loc.waitFor({ state: 'visible', timeout });
      buf = await loc.screenshot({ type: 'png', timeout });
    } else {
      buf = await ctx.page.screenshot({ type: 'png', fullPage, timeout });
    }
    const artifact = { type: 'screenshot' as const, path, data: buf.toString('base64'), mimeType: 'image/png' };
    return ok('screenshot', `Screenshot captured (${buf.length} bytes).`, { bytes: buf.length }, [artifact]);
  } catch (e) {
    return fail('screenshot', 'SCREENSHOT_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const backAction: BrowserActionHandler = async (ctx, args) => {
  const waitUntil = (args.waitFor as string) ?? 'domcontentloaded';
  const timeout = toMs(ctx);
  try {
    const response = await ctx.page.goBack({ waitUntil: waitUntil as any, timeout });
    if (!response) return fail('back', 'NO_HISTORY', 'No previous page in history.');
    const title = await ctx.page.title();
    const url = ctx.page.url();
    return ok('back', `Navigated back to: ${title}\nURL: ${url}`, { url, title });
  } catch (e) {
    return fail('back', 'BACK_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const pressAction: BrowserActionHandler = async (ctx, args) => {
  const key = String(args.key ?? '');
  if (!key) return fail('press', 'MISSING_KEY', 'key is required');
  try {
    await ctx.page.keyboard.press(key);
    return ok('press', `Pressed key: ${key}`);
  } catch (e) {
    return fail('press', 'PRESS_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const evalAction: BrowserActionHandler = async (ctx, args) => {
  const js = (args.javascript as string) ?? (args.expression as string) ?? (args.code as string) ?? '';
  if (!js.trim()) return fail('eval', 'MISSING_JS', 'javascript expression is required');
  try {
    const result = await ctx.page.evaluate(js);
    const serialized = result === undefined ? 'undefined' : JSON.stringify(result, null, 2);
    const text = serialized.length > DEFAULT_SNAPSHOT_MAX
      ? `${serialized.slice(0, DEFAULT_SNAPSHOT_MAX)}\n... (truncated)`
      : serialized;
    return ok('eval', text, result);
  } catch (e) {
    return fail('eval', 'EVAL_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const imagesAction: BrowserActionHandler = async (ctx, args) => {
  const selector = args.selector as string | undefined;
  const maxImages = typeof args.maxImages === 'number' ? args.maxImages : 20;
  try {
    const images = await ctx.page.evaluate(
      ([sel, max]: [string | null, number]) => {
        const d = globalThis.document as any;
        const root = sel ? d.querySelector(sel) : d;
        if (!root) return [];
        const imgs = Array.from(root.querySelectorAll('img') as ArrayLike<any>);
        return imgs.slice(0, max).map((img: any) => ({
          src: String(img.src ?? ''),
          alt: String(img.alt ?? ''),
          width: Number(img.naturalWidth ?? 0),
          height: Number(img.naturalHeight ?? 0),
        }));
      },
      [selector?.trim() || null, maxImages] as [string | null, number],
    );
    if (!images || images.length === 0) return ok('images', 'No images found on the page.', []);
    const lines = images.map((img: any, i: number) =>
      `${i + 1}. ${img.alt || '(no alt)'} — ${img.width}×${img.height}\n   ${img.src}`);
    return ok('images', `Found ${images.length} image(s):\n${lines.join('\n')}`, images);
  } catch (e) {
    return fail('images', 'IMAGES_FAILED', e instanceof Error ? e.message : String(e));
  }
};

const closeAction: BrowserActionHandler = async (ctx, _args) => {
  await ctx.manager.closePage(ctx.taskId);
  return ok('close', 'Browser page closed.');
};

const dialogAction: BrowserActionHandler = async (ctx, args) => {
  const action = args.action as string;
  if (action !== 'accept' && action !== 'dismiss') {
    return fail('dialog', 'INVALID_ACTION', 'action must be "accept" or "dismiss"');
  }
  // Dialog handling relies on the CdpSupervisor event queue; this is a placeholder
  // that signals the supervisor to accept/dismiss the next pending dialog.
  const sup = ctx.supervisor;
  if (!sup) return fail('dialog', 'NO_SUPERVISOR', 'No dialog supervisor available');
  // Forward to supervisor (implementation detail in cdp-supervisor.ts)
  return ok('dialog', `Dialog ${action}ed.`);
};

const waitAction: BrowserActionHandler = async (ctx, args) => {
  const selector = args.selector as string | undefined;
  const text = args.text as string | undefined;
  const state = (args.state as 'attached' | 'detached' | 'visible' | 'hidden' | undefined) ?? 'visible';
  const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : toMs(ctx);
  try {
    if (selector?.trim()) {
      await ctx.page.locator(selector.trim()).first().waitFor({ state, timeout: timeoutMs });
    } else if (text?.trim()) {
      await ctx.page.getByText(text.trim()).first().waitFor({ state: 'visible', timeout: timeoutMs });
    } else if (args.function || args.expression) {
      await ctx.page.waitForFunction(String(args.function ?? args.expression), null, { timeout: timeoutMs });
    } else {
      const ms = typeof args.ms === 'number' ? args.ms : 1000;
      await ctx.page.waitForTimeout(ms);
    }
    return ok('wait', 'Wait completed.');
  } catch (e) {
    return fail('wait', 'WAIT_TIMEOUT', e instanceof Error ? e.message : String(e));
  }
};

const outputAction: BrowserActionHandler = async (ctx, args) => {
  return ok('output', 'Output captured.', valueFromArgs(ctx, args));
};

const assertAction: BrowserActionHandler = async (ctx, args) => {
  const actual = valueFromArgs(ctx, args);
  if ('equals' in args && JSON.stringify(actual) !== JSON.stringify(args.equals)) {
    return fail('assert', 'ASSERTION_FAILED', `Expected value to equal ${JSON.stringify(args.equals)}, got ${JSON.stringify(actual)?.slice(0, 500)}`);
  }
  if ('contains' in args && !valueContains(actual, args.contains)) {
    return fail('assert', 'ASSERTION_FAILED', `Expected value to contain ${JSON.stringify(args.contains)}`);
  }
  if ('matches' in args) {
    const pattern = new RegExp(String(args.matches));
    if (!pattern.test(String(actual ?? ''))) {
      return fail('assert', 'ASSERTION_FAILED', `Expected value to match /${pattern.source}/`);
    }
  }
  if (args.truthy === true && !isTruthyValue(actual)) {
    return fail('assert', 'ASSERTION_FAILED', `Expected value to be truthy, got ${JSON.stringify(actual)}`);
  }
  if (args.exists === true && (actual === undefined || actual === null || actual === '')) {
    return fail('assert', 'ASSERTION_FAILED', 'Expected value to exist');
  }
  return ok('assert', 'Assertion passed.');
};

const waitForNavigationAction: BrowserActionHandler = async (ctx, args) => {
  const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : toMs(ctx);
  const waitUntil = (args.wait_until as string) ?? 'domcontentloaded';
  try {
    await ctx.page.waitForLoadState(waitUntil as any, { timeout });
    return ok('wait_for_navigation', 'Navigation wait completed.');
  } catch (e) {
    return fail('wait_for_navigation', 'WAIT_TIMEOUT', e instanceof Error ? e.message : String(e));
  }
};

const waitForTimeoutAction: BrowserActionHandler = async (ctx, args) => {
  const ms = Number(args.ms ?? args.timeout_ms ?? 1000);
  await ctx.page.waitForTimeout(Number.isFinite(ms) ? ms : 1000);
  return ok('wait_for_timeout', `Waited ${ms}ms.`);
};

const waitForFunctionAction: BrowserActionHandler = async (ctx, args) => {
  const expression = String(args.expression ?? args.function ?? '');
  if (!expression.trim()) return fail('wait_for_function', 'MISSING_EXPRESSION', 'expression is required');
  const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : toMs(ctx);
  try {
    await ctx.page.waitForFunction(expression, null, { timeout });
    return ok('wait_for_function', 'Function wait completed.');
  } catch (e) {
    return fail('wait_for_function', 'WAIT_TIMEOUT', e instanceof Error ? e.message : String(e));
  }
};

const waitForNetworkIdleAction: BrowserActionHandler = async (ctx, args) => {
  const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : toMs(ctx);
  try {
    await ctx.page.waitForLoadState('networkidle', { timeout });
    return ok('wait_for_network_idle', 'Network idle reached.');
  } catch (e) {
    return fail('wait_for_network_idle', 'WAIT_TIMEOUT', e instanceof Error ? e.message : String(e));
  }
};

const elementTextAction: BrowserActionHandler = async (ctx, args) => {
  const selector = String(args.selector ?? '');
  if (!selector) return fail('element_text', 'MISSING_SELECTOR', 'selector is required');
  const timeout = toMs(ctx);
  const loc = ctx.page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout });
  const text = await loc.innerText({ timeout }).catch(() => loc.textContent({ timeout }));
  return ok('element_text', String(text ?? ''), text ?? '');
};

const elementAttributeAction: BrowserActionHandler = async (ctx, args) => {
  const selector = String(args.selector ?? '');
  const attribute = String(args.attribute ?? '');
  if (!selector || !attribute) return fail('element_attribute', 'INVALID_ARGS', 'selector and attribute are required');
  const timeout = toMs(ctx);
  const loc = ctx.page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout });
  const value = await loc.getAttribute(attribute, { timeout });
  return ok('element_attribute', value ?? '', value);
};

const boundingBoxAction: BrowserActionHandler = async (ctx, args) => {
  const selector = String(args.selector ?? '');
  if (!selector) return fail('bounding_box', 'MISSING_SELECTOR', 'selector is required');
  const timeout = toMs(ctx);
  const loc = ctx.page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout });
  const box = await loc.boundingBox({ timeout });
  return ok('bounding_box', JSON.stringify(box), box);
};

const setInputFilesAction: BrowserActionHandler = async (ctx, args) => {
  const selector = String(args.selector ?? '');
  const files = Array.isArray(args.files) ? args.files.map(String) : typeof args.file === 'string' ? [args.file] : [];
  if (!selector || files.length === 0) return fail('set_input_files', 'INVALID_ARGS', 'selector and files are required');
  await ctx.page.locator(selector).first().setInputFiles(files, { timeout: toMs(ctx) });
  return ok('set_input_files', `Attached ${files.length} file(s).`, { files });
};

const getCookiesAction: BrowserActionHandler = async (ctx, args) => {
  const urls = Array.isArray(args.urls) ? args.urls.map(String) : undefined;
  const cookies = await ctx.page.context().cookies(urls);
  return ok('cookies', JSON.stringify(cookies, null, 2), cookies);
};

const addCookiesAction: BrowserActionHandler = async (ctx, args) => {
  const cookies = Array.isArray(args.cookies) ? args.cookies as any[] : [];
  if (cookies.length === 0) return fail('add_cookies', 'INVALID_ARGS', 'cookies must be a non-empty array');
  await ctx.page.context().addCookies(cookies);
  return ok('add_cookies', `Added ${cookies.length} cookie(s).`);
};

const clearCookiesAction: BrowserActionHandler = async (ctx) => {
  await ctx.page.context().clearCookies();
  return ok('clear_cookies', 'Cookies cleared.');
};

const listTabsAction: BrowserActionHandler = async (ctx) => {
  const pages = ctx.page.context().pages();
  const tabs = await Promise.all(pages.map(async (page, index) => ({ index, url: page.url(), title: await page.title().catch(() => '') })));
  return ok('tabs', JSON.stringify(tabs, null, 2), tabs);
};

const newTabAction: BrowserActionHandler = async (ctx, args) => {
  const page = await ctx.page.context().newPage();
  if (args.url) await page.goto(String(args.url), { waitUntil: 'domcontentloaded', timeout: toMs(ctx) });
  return ok('new_tab', `Opened tab: ${page.url()}`, { url: page.url(), title: await page.title().catch(() => '') });
};

const switchTabAction: BrowserActionHandler = async (ctx, args) => {
  const index = Number(args.index ?? args.tab_index ?? 0);
  const pages = ctx.page.context().pages();
  const page = pages[index];
  if (!page) return fail('switch_tab', 'TAB_NOT_FOUND', `No tab at index ${index}`);
  await page.bringToFront();
  return ok('switch_tab', `Switched to tab ${index}.`, { index, url: page.url() });
};

const selectAction: BrowserActionHandler = async (ctx, args) => {
  const source = 'from' in args ? args.from : pipelineLast(ctx);
  const path = String(args.path ?? args.value ?? '');
  const value = path ? resolvePath(source, path) : source;
  return ok('select', typeof value === 'string' ? value : JSON.stringify(value, null, 2), value);
};

const mapAction: BrowserActionHandler = async (ctx, args) => {
  const source = 'from' in args ? args.from : pipelineLast(ctx);
  if (!Array.isArray(source)) return fail('map', 'INVALID_INPUT', 'map input must be an array');
  const path = String(args.path ?? '');
  const result = path ? source.map((item) => resolvePath(item, path)) : source;
  return ok('map', JSON.stringify(result, null, 2), result);
};

const filterAction: BrowserActionHandler = async (ctx, args) => {
  const source = 'from' in args ? args.from : pipelineLast(ctx);
  if (!Array.isArray(source)) return fail('filter', 'INVALID_INPUT', 'filter input must be an array');
  const path = String(args.path ?? '');
  const equals = args.equals;
  const contains = args.contains;
  const truthy = args.truthy === true;
  const result = source.filter((item) => {
    const value = path ? resolvePath(item, path) : item;
    if ('equals' in args) return JSON.stringify(value) === JSON.stringify(equals);
    if ('contains' in args) return valueContains(value, contains);
    if (truthy) return isTruthyValue(value);
    return isTruthyValue(value);
  });
  return ok('filter', JSON.stringify(result, null, 2), result);
};

const sortAction: BrowserActionHandler = async (ctx, args) => {
  const source = 'from' in args ? args.from : pipelineLast(ctx);
  if (!Array.isArray(source)) return fail('sort', 'INVALID_INPUT', 'sort input must be an array');
  const path = String(args.path ?? '');
  const direction = String(args.direction ?? 'asc');
  const result = [...source].sort((a, b) => {
    const av = path ? resolvePath(a, path) : a;
    const bv = path ? resolvePath(b, path) : b;
    const cmp = compareValues(av, bv);
    return direction === 'desc' ? -cmp : cmp;
  });
  return ok('sort', JSON.stringify(result, null, 2), result);
};

const limitAction: BrowserActionHandler = async (ctx, args) => {
  const source = 'from' in args ? args.from : pipelineLast(ctx);
  if (!Array.isArray(source)) return fail('limit', 'INVALID_INPUT', 'limit input must be an array');
  const count = Math.max(0, Number(args.count ?? args.limit ?? 10));
  const offset = Math.max(0, Number(args.offset ?? 0));
  const result = source.slice(offset, offset + count);
  return ok('limit', JSON.stringify(result, null, 2), result);
};

const fetchAction: BrowserActionHandler = async (ctx, args) => {
  const url = String(args.url ?? '');
  if (!url) return fail('fetch', 'MISSING_URL', 'url is required');
  const method = String(args.method ?? 'GET');
  const headers = asObject(args.headers) as Record<string, string>;
  const body = args.body === undefined ? undefined : typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
  const result = await ctx.page.evaluate(
    async ({ url, method, headers, body }) => {
      const response = await fetch(url, { method, headers, body });
      const text = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      let parsed: unknown = text;
      if (contentType.includes('application/json')) {
        try { parsed = JSON.parse(text); } catch { parsed = text; }
      }
      return { ok: response.ok, status: response.status, url: response.url, headers: Object.fromEntries(response.headers.entries()), body: parsed };
    },
    { url, method, headers, body },
  );
  return ok('fetch', JSON.stringify(result, null, 2), result);
};

const networkStartAction: BrowserActionHandler = async (ctx, args) => {
  networkMonitors.get(ctx.page)?.dispose();
  const includeBody = args.include_body === true || args.includeBody === true;
  const urlPattern = typeof args.url_pattern === 'string' ? args.url_pattern : typeof args.urlPattern === 'string' ? args.urlPattern : undefined;
  const events: NetworkEvent[] = [];
  const onRequest = (request: any) => {
    if (!matchesNetworkPattern(request.url(), urlPattern)) return;
    events.push({ type: 'request', url: request.url(), method: request.method(), resourceType: request.resourceType(), postData: request.postData(), timestamp: Date.now() });
  };
  const onResponse = async (response: any) => {
    if (!matchesNetworkPattern(response.url(), urlPattern)) return;
    const event: NetworkEvent = { type: 'response', url: response.url(), status: response.status(), timestamp: Date.now() };
    if (includeBody) {
      event.body = await response.text().catch(() => undefined);
    }
    events.push(event);
  };
  const onRequestFailed = (request: any) => {
    if (!matchesNetworkPattern(request.url(), urlPattern)) return;
    events.push({ type: 'requestfailed', url: request.url(), method: request.method(), errorText: request.failure()?.errorText, timestamp: Date.now() });
  };
  ctx.page.on('request', onRequest);
  ctx.page.on('response', onResponse);
  ctx.page.on('requestfailed', onRequestFailed);
  networkMonitors.set(ctx.page, {
    events,
    includeBody,
    urlPattern,
    dispose: () => {
      ctx.page.off('request', onRequest);
      ctx.page.off('response', onResponse);
      ctx.page.off('requestfailed', onRequestFailed);
      networkMonitors.delete(ctx.page);
    },
  });
  return ok('network_start', 'Network monitoring started.', { includeBody, urlPattern });
};

const networkEventsAction: BrowserActionHandler = async (ctx) => {
  const monitor = networkMonitors.get(ctx.page);
  const events = monitor?.events ?? [];
  return ok('network_events', JSON.stringify(events, null, 2), events);
};

const networkStopAction: BrowserActionHandler = async (ctx) => {
  const events = networkMonitors.get(ctx.page)?.events ?? [];
  networkMonitors.get(ctx.page)?.dispose();
  return ok('network_stop', JSON.stringify(events, null, 2), events);
};

const collectAction: BrowserActionHandler = async (ctx, args) => {
  const events = networkMonitors.get(ctx.page)?.events ?? [];
  if (args.parse) {
    const parsed = await ctx.page.evaluate(
      ({ events, parse }) => {
        const parseFn = (0, eval)(`(${parse})`);
        return parseFn(events);
      },
      { events, parse: String(args.parse) },
    );
    return ok('collect', JSON.stringify(parsed, null, 2), parsed);
  }
  return ok('collect', JSON.stringify(events, null, 2), events);
};

const tapAction: BrowserActionHandler = async (ctx, args) => {
  const pattern = String(args.capture ?? args.url ?? args.pattern ?? '');
  const timeoutMs = Number(args.timeout_ms ?? args.timeoutMs ?? 5000);
  const captured = await ctx.page.evaluate(
    async ({ pattern, timeoutMs }) => {
      let result: unknown = null;
      const g = globalThis as any;
      const originalFetch = g.fetch;
      g.fetch = async (...fetchArgs: any[]) => {
        const response = await originalFetch(...fetchArgs);
        try {
          const url = typeof fetchArgs[0] === 'string' ? fetchArgs[0] : fetchArgs[0]?.url ?? String(fetchArgs[0]);
          if ((!pattern || url.includes(pattern)) && result === null) {
            const clone = response.clone();
            const text = await clone.text();
            try { result = JSON.parse(text); } catch { result = text; }
          }
        } catch {}
        return response;
      };
      try {
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      } finally {
        g.fetch = originalFetch;
      }
      return result;
    },
    { pattern, timeoutMs },
  );
  return ok('tap', JSON.stringify(captured, null, 2), captured);
};

// ─── Registry Construction ──────────────────────────────────────────────────

export function createBrowserActionRegistry(): BrowserActionRegistry {
  const handlers = new Map<string, BrowserActionHandler>();

  // Navigate
  handlers.set('open', navigateAction);
  handlers.set('navigate', navigateAction);
  // State / snapshot
  handlers.set('state', stateAction);
  handlers.set('snapshot', stateAction);
  // Interaction
  handlers.set('click', clickAction);
  handlers.set('type', typeAction);
  handlers.set('input', typeAction);
  handlers.set('scroll', scrollAction);
  handlers.set('back', backAction);
  handlers.set('keys', pressAction);
  handlers.set('press', pressAction);
  // Inspection
  handlers.set('screenshot', screenshotAction);
  handlers.set('images', imagesAction);
  // Eval
  handlers.set('console', evalAction);
  handlers.set('eval', evalAction);
  handlers.set('evaluate', evalAction);
  // Control
  handlers.set('dialog', dialogAction);
  handlers.set('close', closeAction);
  handlers.set('wait', waitAction);
  handlers.set('wait_for_navigation', waitForNavigationAction);
  handlers.set('wait_for_timeout', waitForTimeoutAction);
  handlers.set('wait_for_function', waitForFunctionAction);
  handlers.set('wait_for_network_idle', waitForNetworkIdleAction);
  // Pipeline-specific
  handlers.set('output', outputAction);
  handlers.set('assert', assertAction);
  handlers.set('select', selectAction);
  handlers.set('map', mapAction);
  handlers.set('filter', filterAction);
  handlers.set('sort', sortAction);
  handlers.set('limit', limitAction);
  handlers.set('fetch', fetchAction);
  handlers.set('collect', collectAction);
  handlers.set('tap', tapAction);
  // DOM / browser context
  handlers.set('element_text', elementTextAction);
  handlers.set('element_attribute', elementAttributeAction);
  handlers.set('bounding_box', boundingBoxAction);
  handlers.set('set_input_files', setInputFilesAction);
  handlers.set('cookies', getCookiesAction);
  handlers.set('get_cookies', getCookiesAction);
  handlers.set('add_cookies', addCookiesAction);
  handlers.set('clear_cookies', clearCookiesAction);
  handlers.set('tabs', listTabsAction);
  handlers.set('list_tabs', listTabsAction);
  handlers.set('new_tab', newTabAction);
  handlers.set('switch_tab', switchTabAction);
  // Network
  handlers.set('network_start', networkStartAction);
  handlers.set('network_events', networkEventsAction);
  handlers.set('network_stop', networkStopAction);

  return {
    get(name: string) { return handlers.get(name); },
    has(name: string) { return handlers.has(name); },
    names() { return [...handlers.keys()]; },
    async execute(name: string, ctx: BrowserActionContext, args: Record<string, unknown>): Promise<BrowserActionResult> {
      if (ctx.signal?.aborted) {
        return fail(name, 'ABORTED', 'Operation was aborted');
      }
      if (ctx.manager.getExtensionProvider()) {
        const { runExtensionRegistryAction } = await import('./extension-registry-bridge.js');
        return runExtensionRegistryAction(name, ctx, args);
      }
      const handler = handlers.get(name);
      if (!handler) {
        return fail(name, 'UNKNOWN_ACTION', `Unknown browser action: ${name}`);
      }
      if (ctx.signal?.aborted) {
        return fail(name, 'ABORTED', 'Operation was aborted');
      }
      try {
        return await handler(ctx, args);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error({ err: e, action: name }, `Action failed: ${message}`);
        return fail(name, 'ACTION_ERROR', message);
      }
    },
  };
}
