import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';
import { requireBrowserAssistance } from '../../../../browser/assistance.js';
import { formatBrowserObservation } from '../../../../browser/observation/format.js';
import type { BrowserNotReadyError } from '../../../../browser/readiness.js';
import type { BrowserRuntime } from '../../../../browser/runtime/browser-runtime.js';
import { getEmbeddedExecutionRunId } from '../../../embedded/execution-context.js';

import { BrowserUseSchema, browserUseInputError, decodeBrowserUseInput, type BrowserUseInput } from './schemas.js';

export interface CreateBrowserUseToolDeps {
  getSetupService?: () => import('../../../../browser/setup/service.js').BrowserSetupService | undefined;
  getAgentId?: () => string;
  getRuntime: () => BrowserRuntime;
  getTaskId: () => string;
  getReadiness?: () => Promise<BrowserNotReadyError | null>;
}

export function createBrowserUseTool(
  deps: CreateBrowserUseToolDeps,
): AgentTool<typeof BrowserUseSchema, Record<string, unknown>> {
  return {
    name: 'browser_use',
    label: '🌐 Browser',
    description:
      'Control a persistent browser through typed semantic actions. Start with observe or navigate. Every click, fill, select, press, scroll, wait, upload, and sequence requires the numeric revision from the latest observation, even without an element ref. Use refs from that same observation. When a page requires manual login, CAPTCHA, MFA, or explicit user confirmation in the managed browser, call action="request_user" with a short reason to pause and let the user take over the live browser tab. Read visible data from the latest observation, including labeled textbox values. Once the requested result is visible, report it and finish. Keep any verification in this browser session. Screenshots are attached only when requested or semantic observation is insufficient.',
    parameters: BrowserUseSchema,

    async execute(toolCallId, params: BrowserUseInput, signal) {
      if (params.action === 'request_user') {
        const reason = typeof params.reason === 'string' && params.reason.trim()
          ? params.reason.trim().slice(0, 400)
          : '需要在浏览器中完成登录或人工确认。';
        const conversationId = deps.getTaskId();
        const runtime = deps.getRuntime();
        const liveHandle = runtime.getLiveHandle(conversationId);
        const browserSessionId = params.sessionId || liveHandle?.sessionId || runtime.getSessionId(conversationId);
        const runId = getEmbeddedExecutionRunId();
        if (!browserSessionId || !runId) {
          return {
            content: [{ type: 'text', text: '[INVALID_INPUT] Start a browser session first before requesting user takeover.' }],
            details: { ok: false, kind: 'browser_error', error: { code: 'INVALID_INPUT', message: 'No active browser session for takeover.' } },
          };
        }
        runtime.pinSession(conversationId);
        const url = liveHandle?.getUrl() ?? '';
        const title = liveHandle ? await liveHandle.getTitle().catch(() => '') : '';
        const wait = requireBrowserAssistance(conversationId, runId, toolCallId, {
          browserSessionId,
          reason,
          url,
          title,
        });
        return {
          content: [{ type: 'text', text: reason }],
          details: { ok: true, kind: 'browser_assistance_required', waitId: wait.id, reason, browserSessionId, url },
        };
      }
      const input = decodeBrowserUseInput(params);
      if (!input) {
        const message = browserUseInputError(params.action, params.revision);
        return {
          content: [{ type: 'text', text: `[INVALID_INPUT] ${message}` }],
          details: {
            ok: false,
            kind: 'browser_error',
            error: { code: 'INVALID_INPUT', message },
          },
        };
      }
      const readiness = await deps.getReadiness?.();
      if (readiness && input.action !== 'close') {
        return {
          content: [{ type: 'text', text: `Browser is not ready: ${readiness.hint.detail || readiness.hint.reason}. Open Settings → Browser.` }],
          details: { ok: false, kind: 'browser_setup_required', hint: readiness.hint },
        };
      }

      const setupService = deps.getSetupService?.();
      const verification = setupService?.beforeAction(deps.getTaskId(), deps.getAgentId?.() ?? '', input);
      const result = await deps.getRuntime().execute(
        verification?.taskKey ?? deps.getTaskId(),
        verification?.input ?? input,
        signal,
      );
      if (verification) setupService!.afterAction(verification.setupId, verification.attemptId, verification.input, result);
      return presentResult(result);
    },
  };
}

function presentResult(result: BrowserControlResult) {
  if (result.ok) {
    const observation = result.receipt.observation;
    const text = observation
      ? formatBrowserObservation(observation)
      : result.receipt.tabs
        ? formatTabs(result.receipt.tabs)
        : `${result.receipt.action} completed and verified.`;
    return {
      content: contentWithVisual(text, observation),
      details: { ok: true, receipt: stripVisual(result.receipt) },
    };
  }

  if (!('error' in result)) throw new Error('Invalid browser control result');
  const observation = result.error.observation;
  const recovery = result.error.code === 'SESSION_NOT_FOUND'
    ? 'Call observe without sessionId to get the current session. If it opens a blank page, navigate to the intended page before retrying. Use the new observation’s revision and refs.'
    : '';
  const text = [
    `[${result.error.code}] ${result.error.message}`,
    recovery,
    observation ? formatBrowserObservation(observation) : '',
  ].filter(Boolean).join('\n\n');
  return {
    content: contentWithVisual(text, observation),
    details: {
      ok: false,
      kind: 'browser_error',
      error: stripVisual(result.error),
    },
  };
}

function contentWithVisual(text: string, observation?: BrowserObservation) {
  const content: Array<
    { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  > = [{ type: 'text', text }];
  if (observation?.visual) {
    content.push({ type: 'image', data: observation.visual.data, mimeType: observation.visual.mimeType });
  }
  return content;
}

function formatTabs(tabs: NonNullable<Extract<BrowserControlResult, { ok: true }>['receipt']['tabs']>): string {
  if (tabs.length === 0) return 'No browser tabs are open.';
  return tabs.map((tab) => `- ${tab.id}${tab.active ? ' (active)' : ''}: ${tab.title}\n  ${tab.url}`).join('\n');
}

function stripVisual<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, child) => key === 'visual' ? undefined : child)) as T;
}
