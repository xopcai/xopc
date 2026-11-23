import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const CALLOUT_PREFIX_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

export type CalloutKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

export function insertCalloutBlock(editor: Editor, kind: CalloutKind = 'NOTE', zh = true): boolean {
  const hint = zh ? '在这里输入重点提示内容…' : 'Type callout text…';
  return editor
    .chain()
    .focus()
    .insertContent({
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `[!${kind}] ${hint}` }],
        },
      ],
    })
    .run();
}

export const CalloutDecorations = Extension.create({
  name: 'calloutDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('calloutDecorations'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'blockquote') return;
              const firstText = node.textContent.slice(0, 48);
              const match = firstText.match(CALLOUT_PREFIX_RE);
              if (!match) return;
              const kind = match[1].toUpperCase();
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: `block-editor-callout block-editor-callout-${kind.toLowerCase()}`,
                  'data-callout': kind,
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
