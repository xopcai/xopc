/**
 * Runs browser registry actions against the Chrome Extension bridge (no Playwright page).
 */

import { assertBrowserUrlAllowed, checkPostRedirectUrl, containsApiKeyPattern } from '../url-policy.js';
import { checkWebsiteBlocklist } from '../../agent/tools/url-safety.js';
import { resolveBrowserCommandTimeoutMs } from '../browser-command-timeout.js';
import { truncateSnapshotAtBoundary } from '../snapshot-helpers.js';

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

    case 'output':
      return ok(name, 'Output captured.', args.value ?? ctx.pipelineData);

    case 'assert': {
      const value = String(args.value ?? ctx.pipelineData ?? '');
      const contains = args.contains as string | undefined;
      const equals = args.equals as string | undefined;
      if (contains && !value.includes(contains)) {
        return fail(name, 'ASSERTION_FAILED', `Expected value to contain "${contains}"`);
      }
      if (equals !== undefined && value !== equals) {
        return fail(name, 'ASSERTION_FAILED', `Expected value to equal "${equals}"`);
      }
      return ok(name, 'Assertion passed.');
    }

    case 'network_start':
    case 'network_events':
    case 'network_stop':
    case 'cdp':
      return fail(name, 'NOT_SUPPORTED', `Action "${name}" is not available with the Chrome Extension backend`);

    default:
      return fail(name, 'UNKNOWN_ACTION', `Unknown browser action: ${name}`);
  }
}
