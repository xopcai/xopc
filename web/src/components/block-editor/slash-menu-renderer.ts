import type { Editor } from '@tiptap/core';
import type { SuggestionProps } from '@tiptap/suggestion';

import { runSlashItem, type SlashCommandRuntime, type SlashItem } from './slash-items';

export interface SlashMenuRendererOptions {
  editor: Editor;
  getRuntime: () => SlashCommandRuntime;
}

const PANEL_CLASS =
  'slash-menu-panel fixed z-[9999] w-64 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-edge bg-surface-base shadow-lg';

const ITEM_BASE_CLASS =
  'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors text-fg-muted hover:bg-surface-hover hover:text-fg';

const ITEM_ACTIVE_CLASS = 'bg-surface-hover text-fg';

export function createSlashMenuRenderer({ editor, getRuntime }: SlashMenuRendererOptions) {
  let container: HTMLDivElement | null = null;
  let panel: HTMLDivElement | null = null;
  let scroll: HTMLDivElement | null = null;
  let imageInput: HTMLInputElement | null = null;
  let selectedIndex = 0;
  let lastQuery = '';
  let currentProps: SuggestionProps<SlashItem, SlashItem> | null = null;

  const destroy = () => {
    container?.remove();
    container = null;
    panel = null;
    scroll = null;
    imageInput = null;
    currentProps = null;
    selectedIndex = 0;
    lastQuery = '';
  };

  const ensureMounted = () => {
    if (container) {
      return;
    }

    container = document.createElement('div');
    container.setAttribute('data-slash-menu-root', 'true');

    panel = document.createElement('div');
    panel.className = PANEL_CLASS;

    scroll = document.createElement('div');
    scroll.className = 'slash-menu-scroll max-h-72 overflow-y-auto p-1';

    imageInput = document.createElement('input');
    imageInput.type = 'file';
    imageInput.accept = 'image/*';
    imageInput.className = 'hidden';
    imageInput.addEventListener('change', () => {
      const file = imageInput?.files?.[0];
      const runtime = getRuntime();
      if (file && runtime.onImageUpload) {
        void runtime.onImageUpload(file);
      }
      if (imageInput) {
        imageInput.value = '';
      }
    });

    panel.appendChild(scroll);
    container.append(panel, imageInput);
    document.body.appendChild(container);
  };

  const updatePosition = () => {
    if (!panel || !currentProps) {
      return;
    }

    const rect = currentProps.clientRect?.() ?? currentProps.editor.view.coordsAtPos(currentProps.range.to);
    const padding = 8;
    const gap = 6;
    const below = window.innerHeight - rect.bottom - gap - padding;
    const above = rect.top - gap - padding;
    const preferredHeight = Math.min(scroll?.scrollHeight ?? 0, 288);
    const placeAbove = below < preferredHeight && above > below;
    if (scroll) scroll.style.maxHeight = `min(18rem, ${Math.max(0, placeAbove ? above : below)}px)`;

    panel.style.top = `${placeAbove ? Math.max(padding, rect.top - gap - panel.offsetHeight) : rect.bottom + gap}px`;
    panel.style.left = `${Math.max(padding, Math.min(rect.left, window.innerWidth - panel.offsetWidth - padding))}px`;
  };

  const renderMenu = () => {
    if (!currentProps || !scroll || !panel) {
      return;
    }

    const list = scroll;
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    const zh = getRuntime().locale === 'zh';
    currentProps.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${ITEM_BASE_CLASS}${index === selectedIndex ? ` ${ITEM_ACTIVE_CLASS}` : ''}`;

      const icon = document.createElement('span');
      icon.className =
        'flex size-8 shrink-0 items-center justify-center rounded-md border border-edge bg-surface-inset text-[11px] font-semibold uppercase text-fg-muted';
      icon.textContent = item.badge || item.label.slice(0, 2);

      const copy = document.createElement('span');
      copy.className = 'min-w-0 flex-1';

      const title = document.createElement('span');
      title.className = 'block truncate text-sm font-medium text-fg';
      title.textContent = zh ? item.zhLabel : item.label;

      const description = document.createElement('span');
      description.className = 'block truncate text-xs text-fg-muted';
      description.textContent = zh ? item.zhDescription : item.description;

      copy.append(title, description);
      button.append(icon, copy);

      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (!currentProps) {
          return;
        }
        if (item.id === 'image') {
          runSlashItem(item, currentProps.editor, currentProps.range, {
            ...getRuntime(),
            requestImagePicker:
              getRuntime().requestImagePicker ?? (() => imageInput?.click()),
          });
          return;
        }
        if (item.id === 'file' && !getRuntime().requestFilePicker) {
          runSlashItem(item, currentProps.editor, currentProps.range, {
            ...getRuntime(),
            requestFilePicker: () => imageInput?.click(),
          });
          return;
        }
        currentProps.command(item);
      });

      list.appendChild(button);
    });

    updatePosition();
    list.scrollTop = scrollTop;
    const activeItem = list.children[selectedIndex];
    if (activeItem) {
      const itemRect = activeItem.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      if (itemRect.top < listRect.top) list.scrollTop += itemRect.top - listRect.top;
      if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
    }
  };

  const syncProps = (props: SuggestionProps<SlashItem, SlashItem>) => {
    if (props.query !== lastQuery) {
      selectedIndex = 0;
      lastQuery = props.query;
    }
    currentProps = props;
    ensureMounted();
    renderMenu();
  };

  editor.on('destroy', destroy);

  return {
    onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
      syncProps(props);
    },
    onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
      syncProps(props);
    },
    onExit: () => {
      destroy();
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const items = currentProps?.items ?? [];
      if (!items.length) {
        return false;
      }

      if (event.key === 'ArrowDown') {
        selectedIndex = (selectedIndex + 1) % items.length;
        renderMenu();
        return true;
      }

      if (event.key === 'ArrowUp') {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        renderMenu();
        return true;
      }

      if (event.key === 'Enter') {
        const item = items[selectedIndex];
        if (item && currentProps) {
          if (item.id === 'image') {
            runSlashItem(item, currentProps.editor, currentProps.range, {
              ...getRuntime(),
              requestImagePicker:
                getRuntime().requestImagePicker ?? (() => imageInput?.click()),
            });
          } else {
            currentProps.command(item);
          }
        }
        return true;
      }

      return false;
    },
    destroy,
  };
}
