import { fromHtml } from 'hast-util-from-html';
import type { Element, Root } from 'hast';
import { SKIP, visitParents } from 'unist-util-visit-parents';

import { MAX_MESSAGE_MATH } from './policy';
import { renderMathHtml } from './render';
import { decodeMathSource } from './syntax';
import type { MathRenderContext } from './types';

export function rehypeXopcMath(context: MathRenderContext & { maxCount?: number } = { streaming: false }) {
  return (tree: Root) => {
    let count = 0;
    visitParents(tree, 'element', (node: Element, ancestors) => {
      if (node.tagName !== 'code' || typeof node.properties['data-xopc-math-source'] !== 'string') return;
      const source = decodeMathSource(node.properties['data-xopc-math-source']);
      if (!source) return;
      const replacement = fromHtml(renderMathHtml(source, context, ++count > (context.maxCount ?? MAX_MESSAGE_MATH)), { fragment: true }).children[0];
      const parent = ancestors.at(-1);
      const grandparent = ancestors.at(-2);
      if (!parent || !replacement) return;
      if (parent.type === 'element' && parent.tagName === 'pre' && grandparent) {
        grandparent.children.splice(grandparent.children.indexOf(parent), 1, replacement as Element);
      } else { parent.children.splice(parent.children.indexOf(node), 1, replacement as Element); }
      return SKIP;
    });
  };
}
