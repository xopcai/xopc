import { html } from 'lit';
import { SquareTerminal } from 'lucide';
import { t } from '../../utils/i18n.js';
import { renderHeader } from '../renderer-registry.js';
import type { ToolRenderer, ToolRenderResult, ToolResultMessage } from '../types.js';

interface BashParams {
  command?: string;
}

function getCommand(params: unknown): string {
  if (params && typeof params === 'object' && params !== null && 'command' in params) {
    const c = (params as BashParams).command;
    if (typeof c === 'string') return c;
  }
  try {
    const s = JSON.stringify(params);
    const p = JSON.parse(s) as BashParams;
    if (typeof p?.command === 'string') return p.command;
  } catch {
    /* ignore */
  }
  return '';
}

function outputText(result: ToolResultMessage | undefined): string {
  if (!result?.content?.length) return '';
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

export class BashRenderer implements ToolRenderer<BashParams, undefined> {
  render(
    params: BashParams | undefined,
    result: ToolResultMessage<undefined> | undefined,
    _isStreaming?: boolean,
  ): ToolRenderResult {
    const state = result ? (result.isError ? 'error' : 'complete') : 'inprogress';
    const cmd = params?.command ?? getCommand(params);

    if (result && cmd) {
      const out = outputText(result);
      const combined = out ? `> ${cmd}\n\n${out}` : `> ${cmd}`;
      return {
        content: html`
          <div class="space-y-3">
            ${renderHeader(state, SquareTerminal, t('chat.bashRunning') || 'Running command...')}
            <pre
              class="text-xs font-mono p-2 rounded bg-background border border-border overflow-auto max-h-64 whitespace-pre-wrap ${result.isError ? 'text-red-600 dark:text-red-400' : ''}"
            >${combined}</pre>
          </div>
        `,
        isCustom: false,
      };
    }

    if (cmd) {
      return {
        content: html`
          <div class="space-y-3">
            ${renderHeader(state, SquareTerminal, t('chat.bashRunning') || 'Running command...')}
            <pre
              class="text-xs font-mono p-2 rounded bg-background border border-border overflow-auto whitespace-pre-wrap"
            >${`> ${cmd}`}</pre>
          </div>
        `,
        isCustom: false,
      };
    }

    return {
      content: html`
        <div>${renderHeader(state, SquareTerminal, t('chat.bashWaiting') || 'Waiting for command...')}</div>
      `,
      isCustom: false,
    };
  }
}
