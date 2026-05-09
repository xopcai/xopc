import type { Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Locator, Page } from 'playwright-core';

import type { Config } from '../../../config/schema.js';
import { describeImages } from '../../image/understanding/runtime.js';
import { buildImageToolTextResult } from '../../image/image-helpers.js';
import { runWithImageModelFallback } from '../../image/image-model-fallback.js';
import { resolveImageModelConfigForTool } from '../image-tool.js';
import type { BrowserManager } from './manager.js';
import {
  BrowserBackSchema,
  BrowserCdpSchema,
  BrowserClickSchema,
  BrowserCloseSchema,
  BrowserConsoleSchema,
  BrowserDialogSchema,
  BrowserGetImagesSchema,
  BrowserNavigateSchema,
  BrowserPressSchema,
  BrowserScreenshotSchema,
  BrowserScrollSchema,
  BrowserSnapshotSchema,
  BrowserTypeSchema,
  BrowserVisionSchema,
} from './schemas.js';
import { assertBrowserUrlAllowed, checkPostRedirectUrl, containsApiKeyPattern } from './url-policy.js';
import type { CdpSupervisor } from './cdp-supervisor.js';
import { truncateSnapshotAtBoundary } from './snapshot-helpers.js';

const DEFAULT_SNAPSHOT_MAX = 30_000;
/** Compact snapshot attached to navigate results — keep short to avoid bloating tool output. */
const AUTO_SNAPSHOT_MAX = 8_000;
const NAV_TIMEOUT_MS = 30_000;
const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;

export interface CreateBrowserToolsDeps {
  getManager: () => BrowserManager;
  getTaskId: () => string;
  getConfig: () => Config | undefined;
  /** Optional CDP Supervisor for dialog handling and raw CDP access. */
  getSupervisor?: () => CdpSupervisor | undefined;
}

function resolveClickLocator(page: Page, params: Static<typeof BrowserClickSchema>): Locator {
  const hasSel = Boolean(params.selector?.trim());
  const hasText = Boolean(params.text?.trim());
  const hasRole = Boolean(params.role?.trim());
  const n = (hasSel ? 1 : 0) + (hasText ? 1 : 0) + (hasRole ? 1 : 0);
  if (n !== 1) {
    throw new Error('Provide exactly one of: selector, text, role');
  }
  if (hasSel) {
    return page.locator(params.selector!.trim()).first();
  }
  if (hasText) {
    return page.getByText(params.text!.trim(), { exact: false }).first();
  }
  const raw = params.role!.trim();
  const idx = raw.indexOf(':');
  const role = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  const name = idx >= 0 ? raw.slice(idx + 1).trim() : '';
  if (!role) {
    throw new Error('Invalid role: empty ARIA role');
  }
  // Playwright typings list roles as a union; the model may pass any valid ARIA role string.
  return page.getByRole(role as never, name ? { name } : undefined).first();
}

function resolveTypeLocator(page: Page, params: Static<typeof BrowserTypeSchema>): Locator {
  const hasSel = Boolean(params.selector?.trim());
  const hasLab = Boolean(params.label?.trim());
  if (hasSel === hasLab) {
    throw new Error('Provide exactly one of: selector, label');
  }
  if (hasSel) {
    return page.locator(params.selector!.trim()).first();
  }
  return page.getByLabel(params.label!.trim()).first();
}

async function ariaSnapshotFor(
  page: Page,
  selector: string | undefined,
  maxLength: number,
): Promise<string> {
  const loc = selector?.trim() ? page.locator(selector.trim()).first() : page.locator('body');
  await loc.waitFor({ state: 'attached', timeout: 15_000 });
  let text = await loc.ariaSnapshot({ mode: 'ai', timeout: 15_000 });
  if (!text || !text.trim()) {
    text = '(empty snapshot)';
  }
  if (text.length > maxLength) {
    // Structure-aware truncation: cut at ARIA tree node boundaries
    text = truncateSnapshotAtBoundary(text, maxLength);
  }
  return text;
}

export function createBrowserTools(deps: CreateBrowserToolsDeps): AgentTool[] {
  const pageFor = () => deps.getManager().getPage(deps.getTaskId());

  const navigate: any = {
    name: 'browser_navigate',
    label: '🌐 Browser Navigate',
    description:
      'Navigate the headless browser to a URL. The page persists for this chat session.\n' +
      'Call `browser_snapshot` after navigation to inspect the UI. Only http(s) public URLs; private IPs and localhost are blocked.',
    parameters: BrowserNavigateSchema,

    async execute(_id, params: any, signal) {
      const p = params as { url: string; waitFor?: 'domcontentloaded' | 'load' | 'networkidle' };
      const cfg = deps.getConfig();
      const allowPrivate = cfg?.agents?.defaults?.browser?.allowPrivateUrls === true;

      // Pre-navigation security checks
      if (containsApiKeyPattern(p.url)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Blocked: URL contains what appears to be an API key or token. Secrets must not be sent in URLs.',
            },
          ],
          details: { blocked: true },
        };
      }
      assertBrowserUrlAllowed(p.url, { allowPrivateUrls: allowPrivate });

      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const waitUntil = p.waitFor ?? 'domcontentloaded';
      await page.goto(p.url, {
        waitUntil,
        timeout: NAV_TIMEOUT_MS,
      });
      const title = await page.title();
      const finalUrl = page.url();

      // Post-redirect security: verify the final URL after redirects.
      // A benign URL can redirect to an internal/metadata address.
      if (finalUrl && finalUrl !== p.url) {
        const redirectBlock = checkPostRedirectUrl(finalUrl, { allowPrivateUrls: allowPrivate });
        if (redirectBlock) {
          await page.goto('about:blank').catch(() => {});
          return {
            content: [{ type: 'text', text: redirectBlock }],
            details: { blocked: true, originalUrl: p.url, redirectedTo: finalUrl },
          };
        }
      }

      // Auto-snapshot after navigation so the agent can act immediately
      // without a separate browser_snapshot call (hermes-agent pattern).
      let snapshotText = '';
      try {
        snapshotText = await ariaSnapshotFor(page, undefined, AUTO_SNAPSHOT_MAX);
      } catch {
        // Non-fatal — navigation succeeded; snapshot is a bonus.
      }

      const parts = [`Navigated to: ${title}\nURL: ${finalUrl}`];
      if (snapshotText) {
        parts.push(`\n--- Page Snapshot ---\n${snapshotText}`);
      }
      return {
        content: [{ type: 'text', text: parts.join('') }],
        details: { url: finalUrl, title, snapshotLength: snapshotText.length },
      };
    },
  };

  const snapshot: any = {
    name: 'browser_snapshot',
    label: '📸 Browser Snapshot',
    description:
      'Capture an AI-oriented ARIA snapshot of the current page (YAML-like tree with element refs).\n' +
      'Use after `browser_navigate` to see interactive elements before `browser_click` / `browser_type`.',
    parameters: BrowserSnapshotSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const p = params as { selector?: string; maxLength?: number };
      const maxLength = p.maxLength ?? DEFAULT_SNAPSHOT_MAX;
      try {
        const text = await ariaSnapshotFor(page, p.selector, maxLength);
        return {
          content: [{ type: 'text', text }],
          details: { length: text.length },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Snapshot failed: ${msg}` }],
          details: { length: 0 },
        };
      }
    },
  };

  const click: any = {
    name: 'browser_click',
    label: '🖱️ Browser Click',
    description:
      'Click an element. Provide exactly one targeting mode: `selector` (CSS), `text` (visible text), or `role` (e.g. `button:Submit`).',
    parameters: BrowserClickSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      try {
        const loc = resolveClickLocator(page, params as any);
        await loc.click({ timeout: 15_000 });
        return {
          content: [{ type: 'text', text: 'Click succeeded.' }],
          details: { ok: true },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Click failed: ${msg}` }],
          details: { ok: false },
        };
      }
    },
  };

  const typeTool: any = {
    name: 'browser_type',
    label: '⌨️ Browser Type',
    description:
      'Type into an input. Provide exactly one of `selector` or `label` (associated label text). Optional `pressEnter` to submit.',
    parameters: BrowserTypeSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      try {
        const p = params as { selector?: string; label?: string; text: string; pressEnter?: boolean };
        const loc = resolveTypeLocator(page, p);
        await loc.clear({ timeout: 5000 }).catch(() => {});
        await loc.fill(p.text, { timeout: 15_000 });
        if (p.pressEnter) {
          await page.keyboard.press('Enter');
        }
        return {
          content: [{ type: 'text', text: 'Typed into field.' }],
          details: { ok: true },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Type failed: ${msg}` }],
          details: { ok: false },
        };
      }
    },
  };

  const scroll: any = {
    name: 'browser_scroll',
    label: '📜 Browser Scroll',
    description: 'Scroll the page up or down by a pixel amount (default 500).',
    parameters: BrowserScrollSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const p = params as { direction: 'up' | 'down'; amount?: number };
      const amount = p.amount ?? 500;
      const dy = p.direction === 'down' ? amount : -amount;
      await page.evaluate(
        ({ deltaY }) => {
          (globalThis as unknown as { scrollBy: (x: number, y: number) => void }).scrollBy(0, deltaY);
        },
        { deltaY: dy },
      );
      return {
        content: [{ type: 'text', text: `Scrolled ${p.direction} by ${amount}px.` }],
        details: { ok: true },
      };
    },
  };

  const screenshot: any = {
    name: 'browser_screenshot',
    label: '🖼️ Browser Screenshot',
    description:
      'Take a PNG screenshot of the viewport or a CSS selector. When `agents.defaults.imageModel` is configured, runs vision on the image using `description` as the prompt (default: short UI summary).',
    parameters: BrowserScreenshotSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const cfg = deps.getConfig();
      let buf: Buffer;
      try {
        const p = params as { selector?: string; description?: string };
        if (p.selector?.trim()) {
          const loc = page.locator(p.selector.trim()).first();
          await loc.waitFor({ state: 'visible', timeout: 15_000 });
          buf = await loc.screenshot({ type: 'png', timeout: 15_000 });
        } else {
          buf = await page.screenshot({ type: 'png', fullPage: false, timeout: 15_000 });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Screenshot failed: ${msg}` }],
          details: { error: msg },
        };
      }

      if (buf.length > MAX_SCREENSHOT_BYTES) {
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot too large (${buf.length} bytes, max ${MAX_SCREENSHOT_BYTES}). Try a narrower selector.`,
            },
          ],
          details: { error: 'too_large', bytes: buf.length },
        };
      }

      const imageModelConfig = resolveImageModelConfigForTool({ cfg });
      const prompt =
        (params as { description?: string }).description?.trim() ||
        'Describe this browser screenshot briefly. Focus on visible text, controls, and actionable UI state.';

      if (!imageModelConfig) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Captured PNG screenshot (${buf.length} bytes). Configure agents.defaults.imageModel for automatic visual description.`,
            },
          ],
          details: { bytes: buf.length, vision: false },
        };
      }

      try {
        const runResult = await runWithImageModelFallback({
          toolConfig: imageModelConfig,
          modelOverride: undefined,
          run: async (modelRef) => {
            const { text, provider, model } = await describeImages({
              modelRef,
              prompt,
              images: [{ buffer: buf, mimeType: 'image/png' }],
              timeoutMs: 60_000,
              signal,
            });
            return { text, provider, model };
          },
        });
        const { result: inner, attempts } = runResult;
        return buildImageToolTextResult(
          { text: inner.text, provider: inner.provider, model: inner.model, attempts },
          { bytes: buf.length, vision: true },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot captured (${buf.length} bytes) but vision failed: ${msg}`,
            },
          ],
          details: { bytes: buf.length, visionError: msg },
        };
      }
    },
  };

  const back: any = {
    name: 'browser_back',
    label: '◀️ Browser Back',
    description: 'Navigate back in browser history. Returns the new page URL and title.',
    parameters: BrowserBackSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const p = params as { waitFor?: 'domcontentloaded' | 'load' | 'networkidle' };
      const waitUntil = p.waitFor ?? 'domcontentloaded';
      try {
        const response = await page.goBack({ waitUntil, timeout: NAV_TIMEOUT_MS });
        if (!response) {
          return {
            content: [{ type: 'text', text: 'No previous page in history.' }],
            details: { ok: false },
          };
        }
        const title = await page.title();
        const url = page.url();
        return {
          content: [{ type: 'text', text: `Navigated back to: ${title}\nURL: ${url}` }],
          details: { ok: true, url, title },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Back navigation failed: ${msg}` }],
          details: { ok: false },
        };
      }
    },
  };

  const press: any = {
    name: 'browser_press',
    label: '⌨️ Browser Press',
    description:
      'Press a keyboard key or key combination. Examples: "Enter", "Tab", "Escape", "ArrowDown", "Control+A", "Shift+Enter".',
    parameters: BrowserPressSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const p = params as { key: string };
      try {
        await page.keyboard.press(p.key);
        return {
          content: [{ type: 'text', text: `Pressed key: ${p.key}` }],
          details: { ok: true, key: p.key },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Key press failed: ${msg}` }],
          details: { ok: false },
        };
      }
    },
  };

  const consoleTool: any = {
    name: 'browser_console',
    label: '💻 Browser Console',
    description:
      'Execute JavaScript in the page context and return the result. ' +
      'If no `javascript` parameter is provided, returns the last 50 console log entries.',
    parameters: BrowserConsoleSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const p = params as { javascript?: string };

      if (!p.javascript?.trim()) {
        // Return recent console messages collected by the page
        try {
          const logs: string[] = [];
          const collectHandler = (msg: import('playwright-core').ConsoleMessage) => {
            logs.push(`[${msg.type()}] ${msg.text()}`);
          };
          page.on('console', collectHandler);
          // Give a brief moment to collect any pending messages
          await page.waitForTimeout(100);
          page.off('console', collectHandler);
          const text = logs.length > 0
            ? logs.slice(-50).join('\n')
            : '(no recent console messages)';
          return {
            content: [{ type: 'text', text }],
            details: { mode: 'logs', count: logs.length },
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [{ type: 'text', text: `Console read failed: ${msg}` }],
            details: { ok: false },
          };
        }
      }

      try {
        const result = await page.evaluate(p.javascript);
        const serialized = result === undefined ? 'undefined' : JSON.stringify(result, null, 2);
        const text = serialized.length > DEFAULT_SNAPSHOT_MAX
          ? `${serialized.slice(0, DEFAULT_SNAPSHOT_MAX)}\n... (truncated)`
          : serialized;
        return {
          content: [{ type: 'text', text }],
          details: { mode: 'eval', resultLength: serialized.length },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Eval failed: ${msg}` }],
          details: { ok: false },
        };
      }
    },
  };

  const getImages: any = {
    name: 'browser_get_images',
    label: '🖼️ Browser Get Images',
    description:
      'Extract all visible images from the page with their src, alt text, and dimensions. ' +
      'Useful for understanding page content without screenshots.',
    parameters: BrowserGetImagesSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const p = params as { selector?: string; maxImages?: number };
      const maxImages = p.maxImages ?? 20;

      try {
        // Playwright evaluate runs in the browser context (DOM available).
        // Use a string-based function to avoid TS complaining about missing DOM lib.
        const images = await page.evaluate(
          ([sel, max]: [string | null, number]) => {
            const d = globalThis.document as unknown as {
              querySelector: (s: string) => unknown;
              querySelectorAll: (s: string) => unknown[];
            };
            const root = sel ? d.querySelector(sel) : d;
            if (!root) return [];
            const imgs = Array.from(
              (root as { querySelectorAll: (s: string) => ArrayLike<Record<string, unknown>> }).querySelectorAll('img'),
            );
            return imgs.slice(0, max).map((img) => ({
              src: String(img.src ?? ''),
              alt: String(img.alt ?? ''),
              width: Number(img.naturalWidth ?? 0),
              height: Number(img.naturalHeight ?? 0),
              visible: img.offsetParent !== null,
            }));
          },
          [p.selector?.trim() || null, maxImages] as [string | null, number],
        );
        if (!images || images.length === 0) {
          return {
            content: [{ type: 'text', text: 'No images found on the page.' }],
            details: { count: 0 },
          };
        }
        const lines = images.map(
          (img: { src: string; alt: string; width: number; height: number; visible: boolean }, i: number) =>
            `${i + 1}. ${img.alt || '(no alt)'} — ${img.width}×${img.height} ${img.visible ? '' : '[hidden]'}\n   ${img.src}`,
        );
        return {
          content: [{ type: 'text', text: `Found ${images.length} image(s):\n${lines.join('\n')}` }],
          details: { count: images.length },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Get images failed: ${msg}` }],
          details: { ok: false },
        };
      }
    },
  };

  const closeTool: any = {
    name: 'browser_close',
    label: '❌ Browser Close',
    description:
      'Close the browser page for this session, releasing resources. A new page will be created on the next browser tool call.',
    parameters: BrowserCloseSchema,

    async execute(_id, _params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const taskId = deps.getTaskId();
      await deps.getManager().closePage(taskId);
      return {
        content: [{ type: 'text', text: 'Browser page closed.' }],
        details: { ok: true },
      };
    },
  };

  const visionTool: any = {
    name: 'browser_vision',
    label: '👁️ Browser Vision',
    description:
      'Take a screenshot and analyze it with the vision model. Unlike `browser_screenshot`, this tool *always* runs vision analysis. ' +
      'Requires `agents.defaults.imageModel` to be configured.',
    parameters: BrowserVisionSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const cfg = deps.getConfig();
      const p = params as { prompt?: string; selector?: string };

      const imageModelConfig = resolveImageModelConfigForTool({ cfg });
      if (!imageModelConfig) {
        return {
          content: [
            {
              type: 'text',
              text: 'Vision model not configured. Set `agents.defaults.imageModel` to use browser_vision.',
            },
          ],
          details: { ok: false },
        };
      }

      let buf: Buffer;
      try {
        if (p.selector?.trim()) {
          const loc = page.locator(p.selector.trim()).first();
          await loc.waitFor({ state: 'visible', timeout: 15_000 });
          buf = await loc.screenshot({ type: 'png', timeout: 15_000 });
        } else {
          buf = await page.screenshot({ type: 'png', fullPage: false, timeout: 15_000 });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Screenshot for vision failed: ${msg}` }],
          details: { ok: false },
        };
      }

      if (buf.length > MAX_SCREENSHOT_BYTES) {
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot too large (${buf.length} bytes). Try a narrower selector.`,
            },
          ],
          details: { ok: false, bytes: buf.length },
        };
      }

      const prompt = p.prompt?.trim() ||
        'Describe this browser screenshot in detail. Focus on visible text, interactive elements, layout, and actionable UI state.';

      try {
        const runResult = await runWithImageModelFallback({
          toolConfig: imageModelConfig,
          modelOverride: undefined,
          run: async (modelRef) => {
            const { text, provider, model } = await describeImages({
              modelRef,
              prompt,
              images: [{ buffer: buf, mimeType: 'image/png' }],
              timeoutMs: 60_000,
              signal,
            });
            return { text, provider, model };
          },
        });
        const { result: inner, attempts } = runResult;
        return buildImageToolTextResult(
          { text: inner.text, provider: inner.provider, model: inner.model, attempts },
          { bytes: buf.length, vision: true },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: 'text',
              text: `Vision analysis failed: ${msg}`,
            },
          ],
          details: { bytes: buf.length, visionError: msg },
        };
      }
    },
  };

  const dialogTool: any = {
    name: 'browser_dialog',
    label: '💬 Browser Dialog',
    description:
      'Handle a pending JavaScript dialog (alert, confirm, prompt, beforeunload). ' +
      'Requires CDP Supervisor to be active. Lists pending dialogs if none need handling.',
    parameters: BrowserDialogSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const supervisor = deps.getSupervisor?.();
      if (!supervisor) {
        return {
          content: [{ type: 'text', text: 'CDP Supervisor not active. Dialog handling is not available.' }],
          details: { ok: false },
        };
      }
      const p = params as { action: 'accept' | 'dismiss'; promptText?: string };
      const pending = supervisor.getPendingDialogs();
      if (pending.length === 0) {
        return {
          content: [{ type: 'text', text: 'No pending dialogs.' }],
          details: { ok: true, pendingCount: 0 },
        };
      }

      const handled = await supervisor.handleDialog(p.action, {
        promptText: p.promptText,
      });
      if (!handled) {
        return {
          content: [{ type: 'text', text: 'Dialog already handled or expired.' }],
          details: { ok: false },
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Dialog ${handled.response}: [${handled.type}] "${handled.message}"`,
          },
        ],
        details: { ok: true, dialogId: handled.id, type: handled.type },
      };
    },
  };

  const cdpTool: any = {
    name: 'browser_cdp',
    label: '🔧 Browser CDP',
    description:
      'Send a raw Chrome DevTools Protocol command to the browser. ' +
      'Advanced: use only when Playwright high-level APIs are insufficient.',
    parameters: BrowserCdpSchema,

    async execute(_id, params: any, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const p = params as { method: string; params?: Record<string, unknown> };

      try {
        const cdpSession = await page.context().newCDPSession(page);
        try {
          const result = await cdpSession.send(p.method as never, (p.params ?? {}) as never);
          const serialized = JSON.stringify(result, null, 2);
          const text = serialized.length > DEFAULT_SNAPSHOT_MAX
            ? `${serialized.slice(0, DEFAULT_SNAPSHOT_MAX)}\n... (truncated)`
            : serialized;
          return {
            content: [{ type: 'text', text }],
            details: { ok: true, method: p.method },
          };
        } finally {
          await cdpSession.detach().catch(() => {});
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `CDP command failed: ${msg}` }],
          details: { ok: false, method: p.method },
        };
      }
    },
  };

  return [
    navigate, snapshot, click, typeTool, scroll, screenshot,
    back, press, consoleTool, getImages, closeTool, visionTool,
    dialogTool, cdpTool,
  ];
}
