import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

import { createSlashMenuRenderer } from '../slash-menu-renderer';
import {
  filterSlashItems,
  runSlashItem,
  type SlashCommandRuntime,
  type SlashItem,
} from '../slash-items';

export const slashCommandsPluginKey = new PluginKey('slashCommands');

export interface SlashCommandsStorage {
  active: boolean;
}

export interface SlashCommandsOptions {
  getRuntime: () => SlashCommandRuntime;
}

export const SlashCommands = Extension.create<SlashCommandsOptions, SlashCommandsStorage>({
  name: 'slashCommands',

  addOptions() {
    return {
      getRuntime: () => ({}),
    };
  },

  addStorage() {
    return {
      active: false,
    };
  },

  onDestroy() {
    this.storage.active = false;
  },

  addProseMirrorPlugins() {
    const extension = this;
    const menuRenderer = createSlashMenuRenderer({
      editor: this.editor,
      getRuntime: () => extension.options.getRuntime(),
    });

    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: slashCommandsPluginKey,
        editor: this.editor,
        char: '/',
        allowedPrefixes: null,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => {
          runSlashItem(props, editor, range, extension.options.getRuntime());
        },
        render: () => ({
          onStart: (props) => {
            extension.storage.active = true;
            menuRenderer.onStart(props);
          },
          onUpdate: (props) => {
            menuRenderer.onUpdate(props);
          },
          onExit: () => {
            extension.storage.active = false;
            menuRenderer.onExit();
          },
          onKeyDown: menuRenderer.onKeyDown,
        }),
      }),
    ];
  },
});

declare module '@tiptap/core' {
  interface Storage {
    slashCommands: SlashCommandsStorage;
  }
}
