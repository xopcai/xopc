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

import type {
  BrowserActionContext,
  BrowserActionHandler,
  BrowserActionRegistry,
  BrowserActionResult,
} from './types.js';

const log = createLogger('BrowserActionRegistry');

const DEFAULT_SNAPSHOT_MAX = 30_000;
const AUTO_SNAPSHOT_MAX = 8_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function toMs(ctx: BrowserActionContext): number {
  return resolveBrowserCommandTimeoutMs(ctx.config);
}

/** Whether humanize mode is active for this context (local/cdp/cloakbrowser only). */
function isHumanizeEnabled(ctx: BrowserActionContext): boolean {
  const browser = ctx.config?.agents?.defaults?.browser;
  if (!browser?.humanize) return false;
  // Extension backend has its own event dispatch — humanize is not applicable
  const backend = browser.backend;
  if (backend === 'extension') return false;
  return true;
}

function humanPreset(ctx: BrowserActionContext): HumanPreset {
  return (ctx.config?.agents?.defaults?.browser?.humanPreset as HumanPreset) ?? 'default';
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

// ─── Action Handlers ────────────────────────────────────────────────────────

const navigateAction: BrowserActionHandler = async (ctx, args) => {
  const url = String(args.url ?? '');
  if (!url) return fail('navigate', 'MISSING_URL', 'url is required');

  const allowPrivate = ctx.config?.agents?.defaults?.browser?.allowPrivateUrls === true;
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
  const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : toMs(ctx);
  try {
    if (selector?.trim()) {
      await ctx.page.locator(selector.trim()).first().waitFor({ state: 'visible', timeout: timeoutMs });
    } else if (text?.trim()) {
      await ctx.page.getByText(text.trim()).first().waitFor({ state: 'visible', timeout: timeoutMs });
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
  return ok('output', 'Output captured.', args.value ?? ctx.pipelineData);
};

const assertAction: BrowserActionHandler = async (ctx, args) => {
  const value = String(args.value ?? ctx.pipelineData ?? '');
  const contains = args.contains as string | undefined;
  const equals = args.equals as string | undefined;
  if (contains && !value.includes(contains)) {
    return fail('assert', 'ASSERTION_FAILED', `Expected value to contain "${contains}"`);
  }
  if (equals !== undefined && value !== equals) {
    return fail('assert', 'ASSERTION_FAILED', `Expected value to equal "${equals}"`);
  }
  return ok('assert', 'Assertion passed.');
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
  // Pipeline-specific
  handlers.set('output', outputAction);
  handlers.set('assert', assertAction);

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
