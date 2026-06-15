import { TrailingNode } from '@tiptap/extensions';

/**
 * Ensures a trailing empty paragraph exists after non-paragraph block nodes
 * (images, horizontal rules, code blocks, headings, etc.).
 */
export const BlockTrailingNode = TrailingNode.configure({
  node: 'paragraph',
  notAfter: ['paragraph'],
});
