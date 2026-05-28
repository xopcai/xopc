/**
 * browser_use — unified browser AgentTool.
 *
 * Modes: command | pipeline | inspect | close.
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
import { loadBrowserPipelineSource } from '../../../../browser/pipeline/source.js';

const log = createLogger('browser_use');

export interface CreateBrowserUseToolDeps {
  getManager: () => BrowserManager;
  getPageForTask: () => Promise<Page>;
  getTaskId: () => string;
  getConfig: () => Config | undefined;
  getSupervisor?: () => CdpSupervisor | undefined;
  notifyBrowserPageClosed?: (taskId: string) => void;
  /** Pipeline runner (injected to avoid circular deps; lazy-loaded if not provided). */
  runPipeline?: (yaml: string, args: Record<string, unknown>, ctx: BrowserActionContext, dryRun: boolean) => Promise<BrowserActionResult>;
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
      'Use a persistent browser for web navigation, page inspection, interaction, screenshots, network capture, and scripted browser pipelines. For non-trivial browser tasks, load the "browser" skill first with skill_view.',
    parameters: BrowserUseSchema,

    async execute(_toolCallId, params: any, signal, _onUpdate) {
      const { mode, command, args: cmdArgs, pipeline: pipelineParams, options: _options } = params as {
        mode: string;
        command?: string;
        args?: Record<string, unknown>;
        pipeline?: { yaml?: string; script?: string; path?: string; args?: Record<string, unknown>; dryRun?: boolean };
        options?: { timeout?: number; headless?: boolean };
      };

      // ─── inspect ────────────────────────────────────────────────────────
      if (mode === 'inspect') {
        const mgr = deps.getManager();
        await mgr.ensureConnected();
        const ext = mgr.getExtensionProvider();
        if (ext) {
          const timeout = deps.getConfig?.()?.agents?.defaults?.browser?.commandTimeout;
          const timeoutMs =
            typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
              ? Math.floor(timeout * 1000)
              : 30_000;
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

      // ─── pipeline ──────────────────────────────────────────────────────
      if (mode === 'pipeline') {
        if (!pipelineParams) {
          return {
            content: [{ type: 'text', text: 'Missing `pipeline` parameter for pipeline mode.' }],
            details: { ok: false, mode: 'pipeline' },
          };
        }

        // Resolve YAML source
        let yamlSource = pipelineParams.yaml ?? pipelineParams.script ?? '';

        if (!yamlSource && pipelineParams.path) {
          try {
            yamlSource = (await loadBrowserPipelineSource(pipelineParams.path)).source;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
              content: [{ type: 'text', text: `Failed to read pipeline source: ${msg}` }],
              details: { ok: false, mode: 'pipeline', error: msg },
            };
          }
        }

        if (!yamlSource) {
          return {
            content: [{ type: 'text', text: 'Pipeline mode requires `yaml`, `script`, or `path`.' }],
            details: { ok: false, mode: 'pipeline' },
          };
        }

        const pipelineArgs = (pipelineParams.args as Record<string, unknown>) ?? {};
        const dryRun = pipelineParams.dryRun === true;
        const page = await deps.getPageForTask();
        const ctx = buildContext(page, signal);

        // Use injected runner or lazy-load
        if (deps.runPipeline) {
          const result = await deps.runPipeline(yamlSource, pipelineArgs, ctx, dryRun);
          return formatResult(result);
        }

        // Lazy import pipeline runner
        try {
          const { runBrowserPipeline } = await import('../../../../browser/pipeline/runner.js');
          const result = await runBrowserPipeline(yamlSource, pipelineArgs, ctx, registry, dryRun);
          return formatResult(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error({ err: e }, `Pipeline execution failed: ${msg}`);
          return {
            content: [{ type: 'text', text: `Pipeline failed: ${msg}` }],
            details: { ok: false, mode: 'pipeline', error: msg },
          };
        }
      }

      return {
        content: [{ type: 'text', text: `Unknown mode: ${mode}` }],
        details: { ok: false },
      };
    },
  };
  return tool;
}
