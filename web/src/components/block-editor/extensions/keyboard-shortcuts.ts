import { Extension } from '@tiptap/react';

/**
 * Extra keyboard shortcuts for the block editor:
 * - Cmd+Shift+1/2/3: Toggle heading levels
 * - Cmd+Shift+8: Bullet list
 * - Cmd+Shift+9: Ordered list
 * - Cmd+Shift+0: Task list
 */
export const ExtraKeyboardShortcuts = Extension.create({
  name: 'extraKeyboardShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-1': () => this.editor.chain().focus().toggleHeading({ level: 1 }).run(),
      'Mod-Shift-2': () => this.editor.chain().focus().toggleHeading({ level: 2 }).run(),
      'Mod-Shift-3': () => this.editor.chain().focus().toggleHeading({ level: 3 }).run(),
      'Mod-Shift-8': () => this.editor.chain().focus().toggleBulletList().run(),
      'Mod-Shift-9': () => this.editor.chain().focus().toggleOrderedList().run(),
      'Mod-Shift-0': () => this.editor.chain().focus().toggleTaskList().run(),
    };
  },
});
