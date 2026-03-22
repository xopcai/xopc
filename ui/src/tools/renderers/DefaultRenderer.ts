import { html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Code } from 'lucide';
import { t } from '../../utils/i18n.js';
import { renderCollapsibleHeader, renderHeader } from '../renderer-registry.js';
import type { ToolRenderer, ToolRenderResult, ToolResultMessage } from '../types.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    toolName?: string,
  ): ToolRenderResult {
    const state = result
      ? result.isError
        ? 'error'
        : 'complete'
      : isStreaming
        ? 'inprogress'
        : 'complete';

    const paramsJson = params !== undefined ? formatParamsJson(params) : '';
    const displayName = toolName?.trim() || t('chat.toolCall');
    const title = html`<span class="tool-call-name-badge">${displayName}</span>`;

    const shell = (inner: ReturnType<typeof html>) => {
      if (state === 'inprogress') {
        return html`
          <div class="tool-call-card tool-call-card--running">
            <div class="tool-call-header tool-call-header--static">
              ${renderHeader(state, Code, title)}
            </div>
            <div class="tool-call-body tool-call-body--expanded">
              <div class="tool-call-body-inner">${inner}</div>
            </div>
          </div>
        `;
      }
      const contentRef = createRef<HTMLDivElement>();
      const chevronRef = createRef<HTMLElement>();
      // This branch is only used after `inprogress` (see early return above); keep body collapsed.
      const defaultExpanded = false;
      const bodyClass = defaultExpanded ? 'tool-call-body--expanded' : 'tool-call-body--collapsed';
      return html`
        <div class="tool-call-card">
          ${renderCollapsibleHeader(state, Code, title, contentRef, chevronRef, defaultExpanded)}
          <div ${ref(contentRef)} class="tool-call-body ${bodyClass}">
            <div class="tool-call-body-inner">${inner}</div>
          </div>
        </div>
      `;
    };

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
        content: shell(html`
          ${paramsJson
            ? html`<div>
                <div class="tool-call-code-label">${t('chat.toolInput')}</div>
                <pre class="tool-call-code max-h-40">${unsafeHTML(escapeHtml(paramsJson))}</pre>
              </div>`
            : ''}
          <div>
            <div class="tool-call-code-label">${t('chat.toolOutput')}</div>
            <pre class="tool-call-code max-h-48">${unsafeHTML(escapeHtml(outputText))}</pre>
          </div>
        `),
        isCustom: true,
      };
    }

    if (params !== undefined && paramsJson) {
      if (isStreaming && (paramsJson === '{}' || paramsJson === 'null')) {
        return {
          content: html`
            <div class="tool-call-card tool-call-card--running">
              <div class="tool-call-header tool-call-header--static">
                ${renderHeader('inprogress', Code, title)}
              </div>
              <div class="tool-call-body tool-call-body--expanded">
                <div class="tool-call-body-inner">
                  <div>${t('chat.toolPreparingParams')}</div>
                </div>
              </div>
            </div>
          `,
          isCustom: true,
        };
      }
      return {
        content: shell(html`
          <div>
            <div class="tool-call-code-label">${t('chat.toolInput')}</div>
            <pre class="tool-call-code max-h-40">${unsafeHTML(escapeHtml(paramsJson))}</pre>
          </div>
        `),
        isCustom: true,
      };
    }

    return {
      content: html`
        <div class="tool-call-card tool-call-card--running">
          <div class="tool-call-header tool-call-header--static">
            ${renderHeader(state, Code, title)}
          </div>
          <div class="tool-call-body tool-call-body--expanded">
            <div class="tool-call-body-inner">
              <div>${t('chat.toolPreparing')}</div>
            </div>
          </div>
        </div>
      `,
      isCustom: true,
    };
  }
}
