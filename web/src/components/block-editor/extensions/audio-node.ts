import { Node, mergeAttributes, ReactNodeViewRenderer } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import type { NoteAttachment } from '@/features/notes/notes-api';
import { AudioBlock } from '../audio-block';

const ATTACHMENT_LINK_RE = /^\[([^\]]*)\]\((xopc-attachment:\/\/notes\/[^)]+)\)$/;

interface MarkdownSerializerState {
  write(content: string): void;
  esc(text: string): string;
  closeBlock(node: ProseMirrorNode): void;
}

export interface AudioNodeOptions {
  getAttachments?: () => NoteAttachment[] | undefined;
}

/**
 * Custom Tiptap node for rendering note attachment links (`xopc-attachment://notes/...`)
 * as inline audio players (for audio files) or file attachment cards (for PDFs/docs/files),
 * while round-tripping losslessly back to standard Markdown `[label](href)`.
 */
export const AudioNode = Node.create<AudioNodeOptions>({
  name: 'audioAttachment',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,

  addOptions() {
    return {
      getAttachments: undefined,
    };
  },

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
            label: dom.getAttribute('label') || dom.textContent,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-audio-attachment': '' }), HTMLAttributes.label || 'Attachment'];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioBlock);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const href = String(node.attrs.href ?? '').trim();
          const label = String(node.attrs.label ?? '').trim() || 'Attachment';
          if (!href) return;
          state.write(`[${state.esc(label)}](${href})`);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            const anchors = Array.from(element.querySelectorAll('p > a[href^="xopc-attachment://notes/"]'));
            for (const anchor of anchors) {
              const parent = anchor.parentElement;
              if (!parent || parent.tagName !== 'P') continue;
              const hasOtherNodes = Array.from(parent.childNodes).some(
                (child) => child !== anchor && (child.nodeType !== 3 || Boolean(child.textContent?.trim())),
              );
              if (hasOtherNodes) continue;
              const replacement = element.ownerDocument.createElement('a');
              replacement.setAttribute('data-audio-attachment', '');
              replacement.setAttribute('href', anchor.getAttribute('href') ?? '');
              replacement.setAttribute('label', anchor.textContent ?? '');
              replacement.textContent = anchor.textContent ?? 'Attachment';
              parent.replaceWith(replacement);
            }
          },
        },
      },
    };
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
            const mappedFrom = tr.mapping.map(pos);
            const mappedTo = tr.mapping.map(pos + node.nodeSize);

            // Case 1: raw markdown link text (before markdown parsing)
            const match = text.match(ATTACHMENT_LINK_RE);
            if (match) {
              const label = match[1];
              const href = match[2];
              if (href.includes('xopc-attachment://notes/')) {
                const audioNode = nodeType.create({ href, label });
                tr.replaceWith(mappedFrom, mappedTo, audioNode);
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
              tr.replaceWith(mappedFrom, mappedTo, audioNode);
              modified = true;
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
