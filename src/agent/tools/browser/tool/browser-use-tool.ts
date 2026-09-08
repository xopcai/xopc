import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';
import { formatBrowserObservation } from '../../../../browser/observation/format.js';
import type { BrowserNotReadyError } from '../../../../browser/readiness.js';
import type { BrowserRuntime } from '../../../../browser/runtime/browser-runtime.js';

import { BrowserUseSchema, decodeBrowserUseInput, type BrowserUseInput } from './schemas.js';

export interface CreateBrowserUseToolDeps {
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
      'Control a persistent browser through typed semantic actions. Start with observe or navigate, then use only refs and revision values from the latest observation. Screenshots are attached only when requested or semantic observation is insufficient.',
    parameters: BrowserUseSchema,

    async execute(_toolCallId, params: BrowserUseInput, signal) {
      const input = decodeBrowserUseInput(params);
      if (!input) {
        return {
          content: [{ type: 'text', text: `[INVALID_INPUT] Invalid parameters for browser action "${params.action}".` }],
          details: {
            ok: false,
            kind: 'browser_error',
            error: { code: 'INVALID_INPUT', message: `Invalid parameters for browser action "${params.action}".` },
          },
        };
      }
      const readiness = await deps.getReadiness?.();
      if (readiness) {
        return {
          content: [{ type: 'text', text: `Browser is not ready: ${readiness.hint.detail || readiness.hint.reason}. Open Settings → Browser.` }],
          details: { ok: false, kind: 'browser_setup_required', hint: readiness.hint },
        };
      }

      const result = await deps.getRuntime().execute(
        deps.getTaskId(),
        input,
        signal,
      );
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
  const text = [
    `[${result.error.code}] ${result.error.message}`,
    observation ? formatBrowserObservation(observation) : '',
  ].filter(Boolean).join('\n\n');
  return {
    content: contentWithVisual(text, observation),
    details: {
      ok: false,
      kind: result.error.code === 'APPROVAL_REQUIRED' ? 'browser_approval_required' : 'browser_error',
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
