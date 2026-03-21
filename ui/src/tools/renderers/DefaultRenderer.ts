import { html } from 'lit';
import { Code } from 'lucide';
import { t } from '../../utils/i18n.js';
import { renderHeader } from '../renderer-registry.js';
import type { ToolRenderer, ToolRenderResult, ToolResultMessage } from '../types.js';

function formatParamsJson(params: unknown): string {
  if (params === undefined) return '';
  try {
    return JSON.stringify(JSON.parse(params as string), null, 2);
  } catch {
    try {
      return JSON.stringify(params, null, 2);
    } catch {
      return String(params);
    }
  }
}

export class DefaultRenderer implements ToolRenderer {
  render(
    params: unknown | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult {
    const state = result
      ? result.isError
        ? 'error'
        : 'complete'
      : isStreaming
        ? 'inprogress'
        : 'complete';

    const paramsJson = params !== undefined ? formatParamsJson(params) : '';

    if (result) {
      const raw = result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');

      let outputText: string;
      if (!raw?.trim()) {
        outputText = t('chat.noOutput');
      } else {
        try {
          const parsed = JSON.parse(raw);
          outputText = JSON.stringify(parsed, null, 2);
        } catch {
          outputText = raw;
        }
      }

      return {
        content: html`
          <div class="space-y-3">
            ${renderHeader(state, Code, t('chat.toolCall'))}
            ${paramsJson
              ? html`<div>
                  <div class="text-xs font-medium mb-1 text-muted-foreground">${t('chat.toolInput')}</div>
                  <pre
                    class="text-xs p-2 rounded bg-background overflow-auto max-h-40 border border-border font-mono"
                  >${paramsJson}</pre>
                </div>`
              : ''}
            <div>
              <div class="text-xs font-medium mb-1 text-muted-foreground">${t('chat.toolOutput')}</div>
              <pre
                class="text-xs p-2 rounded bg-background overflow-auto max-h-48 border border-border font-mono"
              >${outputText}</pre>
            </div>
          </div>
        `,
        isCustom: false,
      };
    }

    if (params !== undefined && paramsJson) {
      if (isStreaming && (paramsJson === '{}' || paramsJson === 'null')) {
        return {
          content: html`
            <div>${renderHeader(state, Code, t('chat.toolPreparingParams'))}</div>
          `,
          isCustom: false,
        };
      }
      return {
        content: html`
          <div class="space-y-3">
            ${renderHeader(state, Code, t('chat.toolCall'))}
            <div>
              <div class="text-xs font-medium mb-1 text-muted-foreground">${t('chat.toolInput')}</div>
              <pre
                class="text-xs p-2 rounded bg-background overflow-auto max-h-40 border border-border font-mono"
              >${paramsJson}</pre>
            </div>
          </div>
        `,
        isCustom: false,
      };
    }

    return {
      content: html`
        <div>${renderHeader(state, Code, t('chat.toolPreparing'))}</div>
      `,
      isCustom: false,
    };
  }
}
