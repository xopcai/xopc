import { Node, mergeAttributes, ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { AudioBlock } from '../audio-block';

const ATTACHMENT_LINK_RE = /^\[([^\]]*)\]\((xopc-attachment:\/\/notes\/[^)]+)\)$/;

/**
 * Custom Tiptap node for rendering audio attachment links as inline players.
 * Detects markdown links targeting `xopc-attachment://` audio refs and
 * replaces them with the AudioBlock NodeView (read-only).
 */
export const AudioNode = Node.create({
  name: 'audioAttachment',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      href: { default: null },
      label: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-audio-attachment]',
        getAttrs: (dom) => {
          if (typeof dom === 'string') return false;
          return {
            href: dom.getAttribute('href'),
            label: dom.textContent,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-audio-attachment': '' }), HTMLAttributes.label || 'Audio'];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioBlock);
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;

    return [
      new Plugin({
        key: new PluginKey('audioAttachmentTransform'),
        appendTransaction(_transactions, _oldState, newState) {
          const { tr } = newState;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return;
            if (node.childCount !== 1) return;

            const child = node.firstChild;
            if (!child || child.type.name !== 'text') return;

            const text = child.text ?? '';

            // Case 1: raw markdown link text (before markdown parsing)
            const match = text.match(ATTACHMENT_LINK_RE);
            if (match) {
              const label = match[1];
              const href = match[2];
              if (href.includes('xopc-attachment://notes/')) {
                const audioNode = nodeType.create({ href, label });
                tr.replaceWith(pos, pos + node.nodeSize, audioNode);
                modified = true;
                return;
              }
            }

            // Case 2: tiptap-markdown already parsed the link into a text
            // node with a link mark — detect by checking marks for an
            // xopc-attachment:// href
            const linkMark = child.marks.find(
              (m) =>
                m.type.name === 'link' &&
                typeof m.attrs.href === 'string' &&
                m.attrs.href.includes('xopc-attachment://notes/'),
            );
            if (linkMark) {
              const audioNode = nodeType.create({
                href: linkMark.attrs.href as string,
                label: text,
              });
              tr.replaceWith(pos, pos + node.nodeSize, audioNode);
              modified = true;
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
