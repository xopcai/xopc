/**
 * Runs browser registry actions against the Chrome Extension bridge (no Playwright page).
 */

import { assertBrowserUrlAllowed, checkPostRedirectUrl, containsApiKeyPattern } from '../url-policy.js';
import { checkWebsiteBlocklist } from '../../agent/tools/url-safety.js';
import { resolveBrowserCommandTimeoutMs } from '../browser-command-timeout.js';
import { truncateSnapshotAtBoundary } from '../snapshot-helpers.js';
import { isTruthyValue, resolvePath, valueContains } from '../pipeline/template.js';

import type { BrowserActionContext, BrowserActionResult } from './types.js';

const DEFAULT_SNAPSHOT_MAX = 30_000;
const AUTO_SNAPSHOT_MAX = 8_000;

function toMs(ctx: BrowserActionContext): number {
  return resolveBrowserCommandTimeoutMs(ctx.config);
}

function ok(action: string, text: string, data?: unknown, artifacts?: BrowserActionResult['artifacts']): BrowserActionResult {
  return { ok: true, action, text, data, artifacts };
}

function fail(action: string, code: string, message: string, diagnostics?: BrowserActionResult['diagnostics']): BrowserActionResult {
  return { ok: false, action, error: { code, message }, diagnostics };
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

function formatAxSnapshot(data: unknown, maxLen: number): string {
  const d = data as { nodes?: Array<{ role?: string; name?: string }> } | undefined;
  const nodes = d?.nodes ?? [];
  if (nodes.length === 0) return '(empty snapshot)';
  const lines = nodes.map((n) => `${n.role ?? '?'}: ${n.name ?? ''}`);
  let text = lines.join('\n');
  if (text.length > maxLen) text = truncateSnapshotAtBoundary(text, maxLen);
  return text;
}

export async function runExtensionRegistryAction(
  name: string,
  ctx: BrowserActionContext,
  args: Record<string, unknown>,
): Promise<BrowserActionResult> {
  if (ctx.signal?.aborted) {
    return fail(name, 'ABORTED', 'Operation was aborted');
  }
  const ext = ctx.manager.getExtensionProvider();
  if (!ext) {
    return fail(name, 'NO_EXTENSION', 'Extension backend not connected');
  }

  const timeout = toMs(ctx);
  const allowPrivate = ctx.config?.agents?.defaults?.browser?.allowPrivateUrls === true;

  switch (name) {
    case 'open':
    case 'navigate': {
      const url = String(args.url ?? '');
      if (!url) return fail(name, 'MISSING_URL', 'url is required');
      if (containsApiKeyPattern(url)) return fail(name, 'BLOCKED', 'URL contains API key/token');
      const block = checkWebsiteBlocklist(url, ctx.config?.tools?.web?.blocklist);
      if (block) return fail(name, 'BLOCKED', block.message);
      assertBrowserUrlAllowed(url, { allowPrivateUrls: allowPrivate });

      const r = await ext.sendCommand('navigate', { url }, { timeout });
      if (!r.ok) return fail(name, 'NAVIGATE_FAILED', r.error ?? 'navigate failed');

      const data = r.data as { url?: string; title?: string } | undefined;
      const finalUrl = data?.url ?? url;
      const title = data?.title ?? '';

      if (finalUrl && finalUrl !== url) {
        const redirectBlock = checkPostRedirectUrl(finalUrl, { allowPrivateUrls: allowPrivate });
        if (redirectBlock) {
          await ext.sendCommand('navigate', { url: 'about:blank' }, { timeout: Math.min(10_000, timeout) }).catch(() => {});
          return fail(name, 'REDIRECT_BLOCKED', redirectBlock);
        }
      }

      let snapshot = '';
      try {
        const snap = await ext.sendCommand('snapshot', {}, { timeout });
        if (snap.ok && snap.data) {
          snapshot = formatAxSnapshot(snap.data, AUTO_SNAPSHOT_MAX);
        }
      } catch {
        /* non-fatal */
      }

      const text = `Navigated to: ${title}\nURL: ${finalUrl}${snapshot ? `\n--- Page Snapshot ---\n${snapshot}` : ''}`;
      return ok(name, text, { url: finalUrl, title });
    }

    case 'state':
    case 'snapshot': {
      const maxLen = typeof args.maxLength === 'number' ? args.maxLength : DEFAULT_SNAPSHOT_MAX;
      if (args.selector && String(args.selector).trim()) {
        return fail(name, 'NOT_SUPPORTED', 'selector-scoped state is not supported with the Chrome Extension backend');
      }
      const r = await ext.sendCommand('snapshot', {}, { timeout });
      if (!r.ok) return fail(name, 'SNAPSHOT_FAILED', r.error ?? 'snapshot failed');
      const body = formatAxSnapshot(r.data, maxLen);
      const data = r.data as { url?: string; title?: string } | undefined;
      const header = data?.url ? `URL: ${data.url}\nTitle: ${data.title ?? ''}\n\n` : '';
      return ok(name, `${header}--- Page Snapshot ---\n${body}`, { length: body.length });
    }

    case 'click': {
      const selector = args.selector as string | undefined;
      const text = args.text as string | undefined;
      const role = args.role as string | undefined;
      if (role?.trim()) {
        return fail(name, 'NOT_SUPPORTED', 'role-based click is not supported with the Chrome Extension backend; use selector or text');
      }
      const n = (Boolean(selector?.trim()) ? 1 : 0) + (Boolean(text?.trim()) ? 1 : 0);
      if (n !== 1) {
        return fail(name, 'INVALID_ARGS', 'Provide exactly one of: selector, text');
      }
      const r = await ext.sendCommand('click', { selector: selector?.trim(), text: text?.trim() }, { timeout });
      if (!r.ok) return fail(name, 'CLICK_FAILED', r.error ?? 'click failed');
      return ok(name, 'Click succeeded.');
    }

    case 'type':
    case 'input': {
      const selector = args.selector as string | undefined;
      const label = args.label as string | undefined;
      if (label?.trim() && !selector?.trim()) {
        return fail(name, 'NOT_SUPPORTED', 'label-based typing is not supported with the Chrome Extension backend; use selector');
      }
      const text = String(args.text ?? '');
      if (!text) return fail(name, 'MISSING_TEXT', 'text is required');
      const r = await ext.sendCommand(
        'type',
        { selector: selector?.trim(), text, pressEnter: args.pressEnter === true },
        { timeout },
      );
      if (!r.ok) return fail(name, 'TYPE_FAILED', r.error ?? 'type failed');
      return ok(name, 'Typed into field.');
    }

    case 'scroll': {
      const direction = (args.direction as string) ?? 'down';
      const amount = typeof args.amount === 'number' ? args.amount : 500;
      const deltaY = direction === 'down' ? amount : -amount;
      const r = await ext.sendCommand('scroll', { deltaY }, { timeout });
      if (!r.ok) return fail(name, 'SCROLL_FAILED', r.error ?? 'scroll failed');
      return ok(name, `Scrolled ${direction} by ${amount}px.`);
    }

    case 'back': {
      const r = await ext.sendCommand('back', {}, { timeout });
      if (!r.ok) return fail(name, 'BACK_FAILED', r.error ?? 'back failed');
      const data = r.data as { url?: string; title?: string } | undefined;
      return ok(name, `Navigated back to: ${data?.title ?? ''}\nURL: ${data?.url ?? ''}`, { url: data?.url, title: data?.title });
    }

    case 'screenshot': {
      const fullPage = args.full_page === true || args.fullPage === true;
      const path = args.path as string | undefined;
      const selector = args.selector as string | undefined;
      if (selector?.trim()) {
        return fail(name, 'NOT_SUPPORTED', 'selector-scoped screenshots are not supported with the Chrome Extension backend');
      }
      const r = await ext.sendCommand('screenshot', { fullPage }, { timeout });
      if (!r.ok) return fail(name, 'SCREENSHOT_FAILED', r.error ?? 'screenshot failed');
      const b64 = (r.data as { base64?: string } | undefined)?.base64;
      if (!b64) return fail(name, 'SCREENSHOT_FAILED', 'no image data');
      const artifact = { type: 'screenshot' as const, path, data: b64, mimeType: 'image/png' };
      const approxBytes = Math.floor((b64.length * 3) / 4);
      return ok(name, `Screenshot captured (~${approxBytes} bytes).`, { bytes: approxBytes }, [artifact]);
    }

    case 'keys':
    case 'press': {
      const key = String(args.key ?? '');
      if (!key) return fail(name, 'MISSING_KEY', 'key is required');
      const r = await ext.sendCommand('keys', { key }, { timeout });
      if (!r.ok) return fail(name, 'PRESS_FAILED', r.error ?? 'keys failed');
      return ok(name, `Pressed key: ${key}`);
    }

    case 'console':
    case 'eval':
    case 'evaluate': {
      const js =
        (args.javascript as string) ?? (args.expression as string) ?? (args.code as string) ?? '';
      if (!js.trim()) return fail(name, 'MISSING_JS', 'javascript expression is required');
      const r = await ext.sendCommand('evaluate', { expression: js }, { timeout });
      if (!r.ok) return fail(name, 'EVAL_FAILED', r.error ?? 'evaluate failed');
      const result = (r.data as { result?: unknown } | undefined)?.result;
      const serialized = result === undefined ? 'undefined' : JSON.stringify(result, null, 2);
      const text =
        serialized.length > DEFAULT_SNAPSHOT_MAX
          ? `${serialized.slice(0, DEFAULT_SNAPSHOT_MAX)}\n... (truncated)`
          : serialized;
      return ok(name, text, result);
    }

    case 'images': {
      const selector = args.selector as string | undefined;
      const maxImages = typeof args.maxImages === 'number' ? args.maxImages : 20;
      const expr = `(() => {
        const sel = ${JSON.stringify(selector?.trim() || null)};
        const max = ${JSON.stringify(maxImages)};
        const d = globalThis.document;
        const root = sel ? d.querySelector(sel) : d;
        if (!root) return [];
        const imgs = Array.from(root.querySelectorAll('img'));
        return imgs.slice(0, max).map((img) => ({
          src: String(img.src ?? ''),
          alt: String(img.alt ?? ''),
          width: Number(img.naturalWidth ?? 0),
          height: Number(img.naturalHeight ?? 0),
        }));
      })()`;
      const r = await ext.sendCommand('evaluate', { expression: expr }, { timeout });
      if (!r.ok) return fail(name, 'IMAGES_FAILED', r.error ?? 'evaluate failed');
      const images = (r.data as { result?: unknown[] } | undefined)?.result as
        | Array<{ src: string; alt: string; width: number; height: number }>
        | undefined;
      if (!images || images.length === 0) return ok(name, 'No images found on the page.', []);
      const lines = images.map(
        (img, i) => `${i + 1}. ${img.alt || '(no alt)'} — ${img.width}×${img.height}\n   ${img.src}`,
      );
      return ok(name, `Found ${images.length} image(s):\n${lines.join('\n')}`, images);
    }

    case 'dialog': {
      const action = args.action as string;
      if (action !== 'accept' && action !== 'dismiss') {
        return fail(name, 'INVALID_ACTION', 'action must be "accept" or "dismiss"');
      }
      const r = await ext.sendCommand('dialog', { accept: action === 'accept' }, { timeout });
      if (!r.ok) return fail(name, 'DIALOG_FAILED', r.error ?? 'dialog failed');
      return ok(name, `Dialog ${action}ed.`);
    }

    case 'close': {
      return ok(name, 'Browser page closed.');
    }

    case 'wait': {
      const selector = args.selector as string | undefined;
      const text = args.text as string | undefined;
      const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : timeout;
      if (text?.trim()) {
        return fail(name, 'NOT_SUPPORTED', 'text-based wait is not supported with the Chrome Extension backend; use selector or ms');
      }
      const extArgs: Record<string, unknown> = {};
      if (selector?.trim()) {
        extArgs.selector = selector.trim();
      } else {
        extArgs.ms = typeof args.ms === 'number' ? args.ms : 1000;
      }
      const r = await ext.sendCommand('wait', extArgs, { timeout: timeoutMs });
      if (!r.ok) return fail(name, 'WAIT_TIMEOUT', r.error ?? 'wait failed');
      return ok(name, 'Wait completed.');
    }

    case 'wait_for_timeout': {
      const ms = typeof args.ms === 'number' ? args.ms : typeof args.timeout_ms === 'number' ? args.timeout_ms : 1000;
      const r = await ext.sendCommand('wait', { ms }, { timeout: ms + 1000 });
      if (!r.ok) return fail(name, 'WAIT_TIMEOUT', r.error ?? 'wait failed');
      return ok(name, `Waited ${ms}ms.`);
    }

    case 'output':
      return ok(name, 'Output captured.', valueFromArgs(ctx, args));

    case 'assert': {
      const actual = valueFromArgs(ctx, args);
      if ('equals' in args && JSON.stringify(actual) !== JSON.stringify(args.equals)) {
        return fail(name, 'ASSERTION_FAILED', `Expected value to equal ${JSON.stringify(args.equals)}`);
      }
      if ('contains' in args && !valueContains(actual, args.contains)) {
        return fail(name, 'ASSERTION_FAILED', `Expected value to contain ${JSON.stringify(args.contains)}`);
      }
      if (args.truthy === true && !isTruthyValue(actual)) {
        return fail(name, 'ASSERTION_FAILED', 'Expected value to be truthy');
      }
      if (args.exists === true && (actual === undefined || actual === null || actual === '')) {
        return fail(name, 'ASSERTION_FAILED', 'Expected value to exist');
      }
      return ok(name, 'Assertion passed.');
    }

    case 'select': {
      const source = 'from' in args ? args.from : pipelineLast(ctx);
      const path = String(args.path ?? args.value ?? '');
      const value = path ? resolvePath(source, path) : source;
      return ok(name, typeof value === 'string' ? value : JSON.stringify(value, null, 2), value);
    }

    case 'map': {
      const source = 'from' in args ? args.from : pipelineLast(ctx);
      if (!Array.isArray(source)) return fail(name, 'INVALID_INPUT', 'map input must be an array');
      const path = String(args.path ?? '');
      const value = path ? source.map((item) => resolvePath(item, path)) : source;
      return ok(name, JSON.stringify(value, null, 2), value);
    }

    case 'filter': {
      const source = 'from' in args ? args.from : pipelineLast(ctx);
      if (!Array.isArray(source)) return fail(name, 'INVALID_INPUT', 'filter input must be an array');
      const path = String(args.path ?? '');
      const value = source.filter((item) => {
        const itemValue = path ? resolvePath(item, path) : item;
        if ('equals' in args) return JSON.stringify(itemValue) === JSON.stringify(args.equals);
        if ('contains' in args) return valueContains(itemValue, args.contains);
        return isTruthyValue(itemValue);
      });
      return ok(name, JSON.stringify(value, null, 2), value);
    }

    case 'sort': {
      const source = 'from' in args ? args.from : pipelineLast(ctx);
      if (!Array.isArray(source)) return fail(name, 'INVALID_INPUT', 'sort input must be an array');
      const path = String(args.path ?? '');
      const direction = String(args.direction ?? 'asc');
      const value = [...source].sort((a, b) => {
        const cmp = compareValues(path ? resolvePath(a, path) : a, path ? resolvePath(b, path) : b);
        return direction === 'desc' ? -cmp : cmp;
      });
      return ok(name, JSON.stringify(value, null, 2), value);
    }

    case 'limit': {
      const source = 'from' in args ? args.from : pipelineLast(ctx);
      if (!Array.isArray(source)) return fail(name, 'INVALID_INPUT', 'limit input must be an array');
      const count = Math.max(0, Number(args.count ?? args.limit ?? 10));
      const offset = Math.max(0, Number(args.offset ?? 0));
      const value = source.slice(offset, offset + count);
      return ok(name, JSON.stringify(value, null, 2), value);
    }

    case 'network_start':
    case 'network_events':
    case 'network_stop':
    case 'cdp':
    case 'wait_for_navigation':
    case 'wait_for_function':
    case 'wait_for_network_idle':
    case 'element_text':
    case 'element_attribute':
    case 'bounding_box':
    case 'set_input_files':
    case 'cookies':
    case 'get_cookies':
    case 'add_cookies':
    case 'clear_cookies':
    case 'tabs':
    case 'list_tabs':
    case 'new_tab':
    case 'switch_tab':
    case 'fetch':
    case 'collect':
    case 'tap':
      return fail(name, 'NOT_SUPPORTED', `Action "${name}" is not available with the Chrome Extension backend`);

    default:
      return fail(name, 'UNKNOWN_ACTION', `Unknown browser action: ${name}`);
  }
}
