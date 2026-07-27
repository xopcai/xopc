import type { Editor } from '@tiptap/core';
import type { SuggestionProps } from '@tiptap/suggestion';

import { runSlashItem, type SlashCommandRuntime, type SlashItem } from './slash-items';

export interface SlashMenuRendererOptions {
  editor: Editor;
  getRuntime: () => SlashCommandRuntime;
}

const PANEL_CLASS =
  'slash-menu-panel fixed z-[9999] w-64 overflow-hidden rounded-lg border border-edge bg-surface-base shadow-lg';

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

    const rect = currentProps.clientRect?.() ?? null;
    if (rect) {
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.left = `${rect.left}px`;
      return;
    }

    const coords = currentProps.editor.view.coordsAtPos(currentProps.range.to);
    panel.style.top = `${coords.bottom + 6}px`;
    panel.style.left = `${coords.left}px`;
  };

  const renderMenu = () => {
    if (!currentProps || !scroll || !panel) {
      return;
    }

    scroll.replaceChildren();

    const list = scroll;
    currentProps.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${ITEM_BASE_CLASS}${index === selectedIndex ? ` ${ITEM_ACTIVE_CLASS}` : ''}`;

      const icon = document.createElement('span');
      icon.className =
        'flex size-8 shrink-0 items-center justify-center rounded-md border border-edge bg-surface-raised text-xs font-semibold uppercase text-fg-muted';
      icon.textContent = item.label.slice(0, 2);

      const copy = document.createElement('span');
      copy.className = 'min-w-0 flex-1';

      const title = document.createElement('span');
      title.className = 'block truncate text-sm font-medium text-fg';
      title.textContent = item.label;

      const description = document.createElement('span');
      description.className = 'block truncate text-xs text-fg-muted';
      description.textContent = item.description;

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
        currentProps.command(item);
      });

      list.appendChild(button);
    });

    updatePosition();
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
