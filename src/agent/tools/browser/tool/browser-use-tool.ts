/**
 * browser_use — unified browser AgentTool.
 *
 * Modes: command | inspect | close.
 * Replaces the 14 fine-grained browser_* tools with a single entry point.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createLogger } from '../../../../utils/logger.js';
import type { Config } from '../../../../config/schema.js';
import type { BrowserManager } from '../../../../browser/manager.js';
import type { CdpSupervisor } from '../../../../browser/cdp-supervisor.js';
import type { Page } from 'playwright-core';

import { BrowserUseSchema } from './schemas.js';
import { createBrowserActionRegistry } from '../../../../browser/actions/registry.js';
import type { BrowserActionContext, BrowserActionResult } from '../../../../browser/actions/types.js';
import type { BrowserNotReadyError, BrowserSetupHint } from '../../../../browser/readiness.js';

const log = createLogger('Agent:BrowserUse');

export interface CreateBrowserUseToolDeps {
  getManager: () => BrowserManager;
  getPageForTask: () => Promise<Page>;
  getTaskId: () => string;
  getConfig: () => Config | undefined;
  getSupervisor?: () => CdpSupervisor | undefined;
  notifyBrowserPageClosed?: (taskId: string) => void;
  /**
   * Preflight readiness check. Returns `null` when the configured backend is
   * usable, otherwise a structured hint the chat surface renders as a setup
   * card. Cache the result upstream (~30s) so back-to-back calls don't reprobe.
   */
  getReadiness?: () => Promise<BrowserNotReadyError | null>;
}

export function createBrowserUseTool(deps: CreateBrowserUseToolDeps): AgentTool<any, any> {
  const registry = createBrowserActionRegistry();

  function buildContext(page: Page, signal?: AbortSignal): BrowserActionContext {
    return {
      page,
      manager: deps.getManager(),
      config: deps.getConfig(),
      taskId: deps.getTaskId(),
      supervisor: deps.getSupervisor?.(),
      signal,
    };
  }

  /**
   * Render a {@link BrowserSetupHint} as a tool result. The text body is a
   * JSON envelope (`kind: 'browser_setup_required'`) so the chat surface can
   * detect it and render a Setup card; the embedded `message` keeps the
   * payload human-readable for the LLM so it stops the browser attempt and
   * tells the user to finish setup.
   */
  function formatNotReady(hint: BrowserSetupHint): { content: { type: 'text'; text: string }[]; details: Record<string, unknown> } {
    const message =
      `⚠ Browser is not ready (backend=${hint.backend}, reason=${hint.reason}). ` +
      `Do NOT retry. Tell the user to open Settings → Browser to finish setup, ` +
      `then ask them to confirm before running any browser action again.`;
    const payload = {
      kind: 'browser_setup_required' as const,
      backend: hint.backend,
      reason: hint.reason,
      deepLink: hint.deepLink,
      detail: hint.detail,
      message,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      details: {
        ok: false,
        kind: 'browser_setup_required',
        backend: hint.backend,
        reason: hint.reason,
        deepLink: hint.deepLink,
      },
    };
  }

  function formatResult(result: BrowserActionResult): { content: { type: 'text'; text: string }[]; details: Record<string, unknown> } {
    if (result.ok) {
      const parts: string[] = [];
      if (result.text) parts.push(result.text);
      if (result.data && !result.text) parts.push(JSON.stringify(result.data, null, 2));
      return {
        content: [{ type: 'text', text: parts.join('\n') || 'OK' }],
        details: { ok: true, action: result.action, ...(result.artifacts?.length ? { artifacts: result.artifacts.length } : {}) },
      };
    }
    const parts: string[] = [];
    if (result.error) parts.push(`[${result.error.code}] ${result.error.message}`);
    if (result.diagnostics?.url) parts.push(`URL: ${result.diagnostics.url}`);
    if (result.diagnostics?.snapshot) parts.push(`Snapshot: ${result.diagnostics.snapshot.slice(0, 2000)}`);
    return {
      content: [{ type: 'text', text: parts.join('\n') || 'Failed' }],
      details: { ok: false, action: result.action, error: result.error },
    };
  }

  const tool: any = {
    name: 'browser_use',
    label: '🌐 Browser',
    description:
      'Use a persistent browser for navigation, inspection, interaction, screenshots, and network capture. Use browser_recipe for saved repeatable browser work.',
    parameters: BrowserUseSchema,

    async execute(_toolCallId, params: any, signal, _onUpdate) {
      const { mode, command, args: cmdArgs, options: _options } = params as {
        mode: string;
        command?: string;
        args?: Record<string, unknown>;
        options?: { timeout?: number; headless?: boolean };
      };

      // ─── readiness preflight ────────────────────────────────────────────
      // Probes the configured backend (doctor + WS bridge / CDP / cloud key)
      // before any launch attempt. On failure we short-circuit with a setup
      // hint the chat renders as a card — the agent should stop and ask the
      // user to finish setup instead of looping on launch errors.
      if (deps.getReadiness) {
        try {
          const notReady = await deps.getReadiness();
          if (notReady) {
            return formatNotReady(notReady.hint);
          }
        } catch (e) {
          log.warn({ err: e }, 'Readiness preflight threw; continuing with launch attempt');
        }
      }

      // ─── inspect ────────────────────────────────────────────────────────
      if (mode === 'inspect') {
        const mgr = deps.getManager();
        await mgr.ensureConnected();
        const ext = mgr.getExtensionProvider();
        if (ext) {
          const timeoutMs = 30_000;
          const urlRes = await ext.sendCommand('get_url', {}, { timeout: timeoutMs });
          const titleRes = await ext.sendCommand('get_title', {}, { timeout: timeoutMs });
          const snapRes = await ext.sendCommand('snapshot', {}, { timeout: timeoutMs });
          const url = urlRes.ok && urlRes.data ? String((urlRes.data as { url?: string }).url ?? '') : '';
          const title =
            titleRes.ok && titleRes.data ? String((titleRes.data as { title?: string }).title ?? '') : '';
          let snapText = '';
          if (snapRes.ok && snapRes.data) {
            const nodes = (snapRes.data as { nodes?: Array<{ role?: string; name?: string }> }).nodes ?? [];
            snapText = nodes.map((n) => `${n.role ?? '?'}: ${n.name ?? ''}`).join('\n');
            if (snapText.length > 8000) snapText = `${snapText.slice(0, 8000)}\n... (truncated)`;
          }
          const text = `URL: ${url}\nTitle: ${title}\n${snapText ? `--- Page Snapshot ---\n${snapText}` : ''}`;
          return {
            content: [{ type: 'text', text }],
            details: { ok: true, mode: 'inspect', url, title },
          };
        }
        const page = await deps.getPageForTask();
        const ctx = buildContext(page, signal);
        const result = await registry.execute('state', ctx, {});
        // Augment with URL / title
        const url = page.url();
        const title = await page.title().catch(() => '');
        const text = `URL: ${url}\nTitle: ${title}\n${result.text ?? ''}`;
        return {
          content: [{ type: 'text', text }],
          details: { ok: true, mode: 'inspect', url, title },
        };
      }

      // ─── close ──────────────────────────────────────────────────────────
      if (mode === 'close') {
        const taskId = deps.getTaskId();
        await deps.getManager().ensureConnected();
        await deps.getManager().closePage(taskId);
        deps.notifyBrowserPageClosed?.(taskId);
        return {
          content: [{ type: 'text', text: 'Browser page closed.' }],
          details: { ok: true, mode: 'close' },
        };
      }

      // ─── command ────────────────────────────────────────────────────────
      if (mode === 'command') {
        if (!command) {
          return {
            content: [{ type: 'text', text: 'Missing `command` parameter for command mode.' }],
            details: { ok: false, mode: 'command' },
          };
        }
        const page = await deps.getPageForTask();
        const ctx = buildContext(page, signal);
        const args = cmdArgs ?? {};
        const result = await registry.execute(command, ctx, args);
        return formatResult(result);
      }

      return {
        content: [{ type: 'text', text: `Unknown mode: ${mode}` }],
        details: { ok: false },
      };
    },
  };
  return tool;
}
