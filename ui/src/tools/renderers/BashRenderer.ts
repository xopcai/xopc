import { html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { SquareTerminal } from 'lucide';
import { t } from '../../utils/i18n.js';
import { renderCollapsibleHeader, renderHeader } from '../renderer-registry.js';
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
    isStreaming?: boolean,
    toolName?: string,
  ): ToolRenderResult {
    const state = result
      ? result.isError
        ? 'error'
        : 'complete'
      : isStreaming
        ? 'inprogress'
        : 'complete';
    const cmd = params?.command ?? getCommand(params);
    const displayName = (toolName?.trim() || 'bash');
    const title = html`<span class="tool-call-name-badge">${displayName}</span>`;

    const runningShell = (inner: ReturnType<typeof html>) => html`
      <div class="tool-call-card tool-call-card--running">
        <div class="tool-call-header tool-call-header--static">
          ${renderHeader('inprogress', SquareTerminal, title)}
        </div>
        <div class="tool-call-body tool-call-body--expanded">
          <div class="tool-call-body-inner">${inner}</div>
        </div>
      </div>
    `;

    const doneShell = (inner: ReturnType<typeof html>) => {
      const contentRef = createRef<HTMLDivElement>();
      const chevronRef = createRef<HTMLElement>();
      // Finished bash: collapsed by default; user expands to see command/output.
      const defaultExpanded = false;
      const bodyClass = defaultExpanded ? 'tool-call-body--expanded' : 'tool-call-body--collapsed';
      return html`
        <div class="tool-call-card">
          <div class="px-0 pt-2">
            ${renderCollapsibleHeader(state, SquareTerminal, title, contentRef, chevronRef, defaultExpanded)}
          </div>
          <div ${ref(contentRef)} class="tool-call-body ${bodyClass}">
            <div class="tool-call-body-inner">${inner}</div>
          </div>
        </div>
      `;
    };

    if (result && cmd) {
      const out = outputText(result);
      const combined = out ? `> ${cmd}\n\n${out}` : `> ${cmd}`;
      return {
        content: doneShell(html`
          <pre
            class="text-xs font-mono p-2 rounded bg-background border border-border overflow-auto max-h-64 whitespace-pre-wrap ${result.isError ? 'text-red-600 dark:text-red-400' : ''}"
          >${combined}</pre>
        `),
        isCustom: true,
      };
    }

    if (cmd) {
      return {
        content: runningShell(html`
          <pre
            class="text-xs font-mono p-2 rounded bg-background border border-border overflow-auto whitespace-pre-wrap"
          >${`> ${cmd}`}</pre>
        `),
        isCustom: true,
      };
    }

    return {
      content: runningShell(html`
        <div class="text-sm text-muted-foreground">${t('chat.bashWaiting') || 'Waiting for command...'}</div>
      `),
      isCustom: true,
    };
  }
}
