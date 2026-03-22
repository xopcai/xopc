import { html, type TemplateResult } from 'lit';
import type { Ref } from 'lit/directives/ref.js';
import { ref } from 'lit/directives/ref.js';
import { ChevronUp, ChevronsUpDown, Loader } from 'lucide';
import { lucideIcon } from '../utils/lucide-icon.js';
import type { ToolRenderer } from './types.js';

export const toolRenderers = new Map<string, ToolRenderer>();

export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  toolRenderers.set(toolName, renderer);
}

export function getToolRenderer(toolName: string): ToolRenderer | undefined {
  return toolRenderers.get(toolName);
}

export function renderHeader(
  state: 'inprogress' | 'complete' | 'error',
  toolIcon: unknown,
  text: string | TemplateResult,
): TemplateResult {
  const statusIcon = (icon: unknown, color: string) =>
    html`<span class="inline-block ${color}">${lucideIcon(icon, 'w-4 h-4')}</span>`;

  switch (state) {
    case 'inprogress':
      return html`
        <div class="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <div class="flex items-center gap-2">
            ${statusIcon(toolIcon, 'text-foreground')}
            ${text}
          </div>
          ${statusIcon(Loader, 'text-foreground animate-spin')}
        </div>
      `;
    case 'complete':
      return html`
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          ${statusIcon(toolIcon, 'text-muted-foreground opacity-90')}
          ${text}
        </div>
      `;
    case 'error':
      return html`
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          ${statusIcon(toolIcon, 'text-red-600 dark:text-red-400')}
          ${text}
        </div>
      `;
  }
}

export function renderCollapsibleHeader(
  state: 'inprogress' | 'complete' | 'error',
  toolIcon: unknown,
  text: string | TemplateResult,
  contentRef: Ref<HTMLElement>,
  chevronRef: Ref<HTMLElement>,
  defaultExpanded = true,
): TemplateResult {
  const statusIcon = (icon: unknown, color: string) =>
    html`<span class="inline-block ${color}">${lucideIcon(icon, 'w-4 h-4')}</span>`;

  const toggleContent = (e: Event) => {
    e.preventDefault();
    const content = contentRef.value;
    const chevron = chevronRef.value;
    if (content && chevron) {
      const isCollapsed = content.classList.contains('tool-call-body--collapsed');
      if (isCollapsed) {
        content.classList.remove('tool-call-body--collapsed');
        content.classList.add('tool-call-body--expanded');
        const upIcon = chevron.querySelector('.chevron-up');
        const downIcon = chevron.querySelector('.chevrons-up-down');
        if (upIcon && downIcon) {
          upIcon.classList.remove('tool-call-chevron-hidden');
          downIcon.classList.add('tool-call-chevron-hidden');
        }
      } else {
        content.classList.remove('tool-call-body--expanded');
        content.classList.add('tool-call-body--collapsed');
        const upIcon = chevron.querySelector('.chevron-up');
        const downIcon = chevron.querySelector('.chevrons-up-down');
        if (upIcon && downIcon) {
          upIcon.classList.add('tool-call-chevron-hidden');
          downIcon.classList.remove('tool-call-chevron-hidden');
        }
      }
    }
  };

  const toolIconColor =
    state === 'complete'
      ? 'text-muted-foreground opacity-90'
      : state === 'error'
        ? 'text-red-600 dark:text-red-400'
        : 'text-foreground';

  return html`
    <button
      type="button"
      @click=${toggleContent}
      class="tool-call-header"
    >
      <div class="flex items-center gap-2 min-w-0">
        ${state === 'inprogress' ? statusIcon(Loader, 'text-foreground animate-spin shrink-0') : ''}
        ${statusIcon(toolIcon, `${toolIconColor} shrink-0`)}
        <span class="min-w-0">${text}</span>
      </div>
      <span class="tool-call-chevron text-muted-foreground shrink-0" ${ref(chevronRef)}>
        <span class="chevron-up ${defaultExpanded ? '' : 'tool-call-chevron-hidden'}"
          >${lucideIcon(ChevronUp, 'w-4 h-4')}</span
        >
        <span class="chevrons-up-down ${defaultExpanded ? 'tool-call-chevron-hidden' : ''}"
          >${lucideIcon(ChevronsUpDown, 'w-4 h-4')}</span
        >
      </span>
    </button>
  `;
}
