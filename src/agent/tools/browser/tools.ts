import type { Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Locator, Page } from 'playwright-core';

import type { Config } from '../../../config/schema.js';
import { describeImagesWithPiAi } from '../../image/describe-images.js';
import { buildImageToolTextResult } from '../../image/image-helpers.js';
import { runWithImageModelFallback } from '../../image/image-model-fallback.js';
import { resolveImageModelConfigForTool } from '../image-tool.js';
import type { BrowserManager } from './manager.js';
import {
  BrowserClickSchema,
  BrowserNavigateSchema,
  BrowserScreenshotSchema,
  BrowserScrollSchema,
  BrowserSnapshotSchema,
  BrowserTypeSchema,
} from './schemas.js';
import { assertBrowserUrlAllowed } from './url-policy.js';

const DEFAULT_SNAPSHOT_MAX = 30_000;
const NAV_TIMEOUT_MS = 30_000;
const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;

export interface CreateBrowserToolsDeps {
  getManager: () => BrowserManager;
  getTaskId: () => string;
  getConfig: () => Config | undefined;
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
    text = `${text.slice(0, maxLength)}\n... (truncated)`;
  }
  return text;
}

export function createBrowserTools(deps: CreateBrowserToolsDeps): AgentTool<any, any>[] {
  const pageFor = () => deps.getManager().getPage(deps.getTaskId());

  const navigate: AgentTool<typeof BrowserNavigateSchema, { url: string; title: string }> = {
    name: 'browser_navigate',
    label: '🌐 Browser Navigate',
    description:
      'Navigate the headless browser to a URL. The page persists for this chat session.\n' +
      'Call `browser_snapshot` after navigation to inspect the UI. Only http(s) public URLs; private IPs and localhost are blocked.',
    parameters: BrowserNavigateSchema,

    async execute(_id, params, signal) {
      assertBrowserUrlAllowed(params.url);
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const waitUntil = params.waitFor ?? 'domcontentloaded';
      await page.goto(params.url, {
        waitUntil,
        timeout: NAV_TIMEOUT_MS,
      });
      const title = await page.title();
      const url = page.url();
      return {
        content: [{ type: 'text', text: `Navigated to: ${title}\nURL: ${url}` }],
        details: { url, title },
      };
    },
  };

  const snapshot: AgentTool<typeof BrowserSnapshotSchema, { length: number }> = {
    name: 'browser_snapshot',
    label: '📸 Browser Snapshot',
    description:
      'Capture an AI-oriented ARIA snapshot of the current page (YAML-like tree with element refs).\n' +
      'Use after `browser_navigate` to see interactive elements before `browser_click` / `browser_type`.',
    parameters: BrowserSnapshotSchema,

    async execute(_id, params, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const maxLength = params.maxLength ?? DEFAULT_SNAPSHOT_MAX;
      try {
        const text = await ariaSnapshotFor(page, params.selector, maxLength);
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

  const click: AgentTool<typeof BrowserClickSchema, { ok: boolean }> = {
    name: 'browser_click',
    label: '🖱️ Browser Click',
    description:
      'Click an element. Provide exactly one targeting mode: `selector` (CSS), `text` (visible text), or `role` (e.g. `button:Submit`).',
    parameters: BrowserClickSchema,

    async execute(_id, params, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      try {
        const loc = resolveClickLocator(page, params);
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

  const typeTool: AgentTool<typeof BrowserTypeSchema, { ok: boolean }> = {
    name: 'browser_type',
    label: '⌨️ Browser Type',
    description:
      'Type into an input. Provide exactly one of `selector` or `label` (associated label text). Optional `pressEnter` to submit.',
    parameters: BrowserTypeSchema,

    async execute(_id, params, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      try {
        const loc = resolveTypeLocator(page, params);
        await loc.clear({ timeout: 5000 }).catch(() => {});
        await loc.fill(params.text, { timeout: 15_000 });
        if (params.pressEnter) {
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

  const scroll: AgentTool<typeof BrowserScrollSchema, { ok: boolean }> = {
    name: 'browser_scroll',
    label: '📜 Browser Scroll',
    description: 'Scroll the page up or down by a pixel amount (default 500).',
    parameters: BrowserScrollSchema,

    async execute(_id, params, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const amount = params.amount ?? 500;
      const dy = params.direction === 'down' ? amount : -amount;
      await page.evaluate(({ deltaY }) => window.scrollBy(0, deltaY), { deltaY: dy });
      return {
        content: [{ type: 'text', text: `Scrolled ${params.direction} by ${amount}px.` }],
        details: { ok: true },
      };
    },
  };

  const screenshot: AgentTool<typeof BrowserScreenshotSchema, Record<string, unknown>> = {
    name: 'browser_screenshot',
    label: '🖼️ Browser Screenshot',
    description:
      'Take a PNG screenshot of the viewport or a CSS selector. When `agents.defaults.imageModel` is configured, runs vision on the image using `description` as the prompt (default: short UI summary).',
    parameters: BrowserScreenshotSchema,

    async execute(_id, params, signal) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const page = await pageFor();
      const cfg = deps.getConfig();
      let buf: Buffer;
      try {
        if (params.selector?.trim()) {
          const loc = page.locator(params.selector.trim()).first();
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
        params.description?.trim() ||
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
            const { text, provider, model } = await describeImagesWithPiAi({
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

  return [navigate, snapshot, click, typeTool, scroll, screenshot];
}
