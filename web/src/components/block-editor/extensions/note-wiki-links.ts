import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';

import { listNotes, type NoteIndexEntry } from '@/features/notes/notes-api';

export const noteWikiLinksPluginKey = new PluginKey('noteWikiLinks');

export interface NoteWikiLinksOptions {
  getCurrentNoteId?: () => string | undefined;
  getLocale?: () => 'en' | 'zh';
}

function createWikiLinkMenuRenderer(getLocale?: () => 'en' | 'zh') {
  let root: HTMLDivElement | null = null;
  let panel: HTMLDivElement | null = null;
  let selectedIndex = 0;
  let latestProps: SuggestionProps<NoteIndexEntry, NoteIndexEntry> | null = null;

  function ensureDom(): HTMLDivElement {
    if (root && panel) return panel;
    root = document.createElement('div');
    root.setAttribute('data-wiki-link-menu-root', '');
    root.style.position = 'fixed';
    root.style.zIndex = '10000';
    root.style.left = '0px';
    root.style.top = '0px';

    panel = document.createElement('div');
    panel.className = 'slash-menu-panel';
    panel.setAttribute('role', 'listbox');
    root.appendChild(panel);
    document.body.appendChild(root);
    return panel;
  }

  function updatePosition(props: SuggestionProps<NoteIndexEntry, NoteIndexEntry>) {
    if (!root || !panel) return;
    const rect = props.clientRect?.();
    if (!rect) return;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const panelW = panel.offsetWidth || 260;
    const panelH = panel.offsetHeight || 220;
    const left = Math.max(8, Math.min(rect.left, viewportW - panelW - 8));
    const top = rect.bottom + 6 + panelH > viewportH
      ? Math.max(8, rect.top - panelH - 6)
      : rect.bottom + 6;
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
  }

  function renderItems() {
    const props = latestProps;
    if (!props) return;
    const container = ensureDom();
    const zh = (getLocale?.() ?? 'zh') === 'zh';
    container.replaceChildren();

    if (props.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slash-menu-empty';
      empty.textContent = zh ? '未找到匹配的笔记' : 'No matching notes';
      container.appendChild(empty);
      updatePosition(props);
      return;
    }

    selectedIndex = Math.max(0, Math.min(selectedIndex, props.items.length - 1));

    props.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === selectedIndex));
      button.className = `slash-menu-item${index === selectedIndex ? ' is-selected' : ''}`;

      const badge = document.createElement('span');
      badge.className = 'slash-menu-badge';
      badge.textContent = item.kind === 'voice' ? '🎙' : '↗';

      const copy = document.createElement('span');
      copy.className = 'slash-menu-copy';

      const title = document.createElement('span');
      title.className = 'slash-menu-label';
      title.textContent =
        item.title?.trim() || item.snippet?.slice(0, 36) || (zh ? '无标题笔记' : 'Untitled note');

      const desc = document.createElement('span');
      desc.className = 'slash-menu-description';
      desc.textContent = item.snippet?.trim().slice(0, 60) || (zh ? '点击插入双链引用' : 'Insert note link');

      copy.append(title, desc);
      button.append(badge, copy);

      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        props.command(item);
      });

      container.appendChild(button);
    });

    updatePosition(props);
  }

  function cleanup() {
    root?.remove();
    root = null;
    panel = null;
    latestProps = null;
    selectedIndex = 0;
  }

  return {
    onStart(props: SuggestionProps<NoteIndexEntry, NoteIndexEntry>) {
      latestProps = props;
      selectedIndex = 0;
      renderItems();
    },
    onUpdate(props: SuggestionProps<NoteIndexEntry, NoteIndexEntry>) {
      latestProps = props;
      selectedIndex = 0;
      renderItems();
    },
    onExit() {
      cleanup();
    },
    onKeyDown({ event }: SuggestionKeyDownProps): boolean {
      if (!latestProps) return false;
      if (event.key === 'Escape') {
        cleanup();
        return true;
      }
      if (latestProps.items.length === 0) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex = (selectedIndex + 1) % latestProps.items.length;
        renderItems();
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = (selectedIndex - 1 + latestProps.items.length) % latestProps.items.length;
        renderItems();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const target = latestProps.items[selectedIndex];
        if (target) latestProps.command(target);
        return true;
      }
      return false;
    },
  };
}

export const NoteWikiLinks = Extension.create<NoteWikiLinksOptions>({
  name: 'noteWikiLinks',

  addOptions() {
    return {
      getCurrentNoteId: undefined,
      getLocale: undefined,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    const renderer = createWikiLinkMenuRenderer(() => extension.options.getLocale?.() ?? 'zh');

    return [
      Suggestion<NoteIndexEntry, NoteIndexEntry>({
        pluginKey: noteWikiLinksPluginKey,
        editor: this.editor,
        char: '[[',
        allowedPrefixes: null,
        items: async ({ query }) => {
          try {
            const currentId = extension.options.getCurrentNoteId?.();
            const res = await listNotes({
              search: query.trim() || undefined,
              sortBy: 'updatedAt',
              sortOrder: 'desc',
              limit: 8,
            });
            return res.items.filter((item) => item.id !== currentId);
          } catch {
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          const zh = (extension.options.getLocale?.() ?? 'zh') === 'zh';
          const label =
            props.title?.trim() || props.snippet?.slice(0, 32) || (zh ? '无标题笔记' : 'Untitled note');
          const href = `xopc://open?kind=note&id=${encodeURIComponent(props.id)}`;
          const afterRange = editor.state.doc.textBetween(range.to, Math.min(editor.state.doc.content.size, range.to + 2));
          const deleteTo = afterRange === ']]' ? range.to + 2 : range.to;

          editor
            .chain()
            .focus()
            .deleteRange({ from: range.from, to: deleteTo })
            .insertContent([
              {
                type: 'text',
                text: label,
                marks: [{ type: 'link', attrs: { href } }],
              },
              {
                type: 'text',
                text: ' ',
              },
            ])
            .run();
        },
        render: () => renderer,
      }),
    ];
  },
});
