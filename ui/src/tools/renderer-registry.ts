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
          ${statusIcon(toolIcon, 'text-green-600 dark:text-green-500')}
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
  defaultExpanded = false,
): TemplateResult {
  const statusIcon = (icon: unknown, color: string) =>
    html`<span class="inline-block ${color}">${lucideIcon(icon, 'w-4 h-4')}</span>`;

  const toggleContent = (e: Event) => {
    e.preventDefault();
    const content = contentRef.value;
    const chevron = chevronRef.value;
    if (content && chevron) {
      const isCollapsed = content.classList.contains('max-h-0');
      if (isCollapsed) {
        content.classList.remove('max-h-0');
        content.classList.add('max-h-[2000px]', 'mt-3');
        const upIcon = chevron.querySelector('.chevron-up');
        const downIcon = chevron.querySelector('.chevrons-up-down');
        if (upIcon && downIcon) {
          upIcon.classList.remove('hidden');
          downIcon.classList.add('hidden');
        }
      } else {
        content.classList.remove('max-h-[2000px]', 'mt-3');
        content.classList.add('max-h-0');
        const upIcon = chevron.querySelector('.chevron-up');
        const downIcon = chevron.querySelector('.chevrons-up-down');
        if (upIcon && downIcon) {
          upIcon.classList.add('hidden');
          downIcon.classList.remove('hidden');
        }
      }
    }
  };

  const toolIconColor =
    state === 'complete'
      ? 'text-green-600 dark:text-green-500'
      : state === 'error'
        ? 'text-red-600 dark:text-red-400'
        : 'text-foreground';

  return html`
    <button
      type="button"
      @click=${toggleContent}
      class="flex items-center justify-between gap-2 text-sm text-muted-foreground w-full text-left hover:text-foreground transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-2">
        ${state === 'inprogress' ? statusIcon(Loader, 'text-foreground animate-spin') : ''}
        ${statusIcon(toolIcon, toolIconColor)}
        ${text}
      </div>
      <span class="inline-block text-muted-foreground" ${ref(chevronRef)}>
        <span class="chevron-up ${defaultExpanded ? '' : 'hidden'}">${lucideIcon(ChevronUp, 'w-4 h-4')}</span>
        <span class="chevrons-up-down ${defaultExpanded ? 'hidden' : ''}"
          >${lucideIcon(ChevronsUpDown, 'w-4 h-4')}</span
        >
      </span>
    </button>
  `;
}
