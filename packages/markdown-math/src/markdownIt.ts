import type MarkdownIt from 'markdown-it';

import { MAX_MESSAGE_MATH } from './policy';
import { renderMathHtml } from './render';
import { mathFenceSource, mathPlaceholder, readDisplayMathAt, readInlineMathAt, readMathFenceAt } from './syntax';
import type { MathSource } from './types';

const installed = new WeakSet<MarkdownIt>();
export function markdownItMath(md: MarkdownIt, options: { placeholder?: boolean } = {}): void {
  if (installed.has(md)) return;
  installed.add(md);
  md.inline.ruler.before('escape', 'xopc_math_inline', (state, silent) => {
    const source = readInlineMathAt(state.src, state.pos);
    if (!source) return false;
    if (!silent) { const token = state.push('xopc_math', '', 0); token.meta = source; token.content = source.raw; }
    state.pos = source.range.end;
    return true;
  });
  md.block.ruler.before('fence', 'xopc_math_block', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    let last = start + 1;
    while (last < end && (state.isEmpty(last) || state.sCount[last] >= state.blkIndent)) last++;
    const text = state.getLines(start, last, state.blkIndent, false);
    const source = readDisplayMathAt(text) ?? readMathFenceAt(text);
    if (!source) return false;
    if (silent) return true;
    const consumed = text.slice(0, source.range.end).split('\n').length;
    state.line = Math.min(last, start + consumed);
    const token = state.push('xopc_math', '', 0);
    token.block = true; token.map = [start, state.line]; token.meta = source;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  const draw = (source: MathSource, env: { streaming?: boolean; xopcMathCount?: number }) => {
    if (options.placeholder) return mathPlaceholder(source);
    env.xopcMathCount = (env.xopcMathCount ?? 0) + 1;
    return renderMathHtml(source, { streaming: env.streaming ?? false }, env.xopcMathCount > MAX_MESSAGE_MATH);
  };
  md.renderer.rules.xopc_math = (tokens, index, _options, env = {}) => draw(tokens[index].meta as MathSource, env);
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, index, opts, env, renderer) => {
    // Image labels are plain alt text, even when the inline parser saw math syntax.
    for (const child of tokens[index].children ?? []) {
      if (child.type === 'xopc_math') child.type = 'text';
    }
    return image(tokens, index, opts, env, renderer);
  };
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, index, opts, env = {}, renderer) => {
    const token = tokens[index];
    if (token.info.trim() !== 'math') return fence(tokens, index, opts, env, renderer);
    const raw = `${token.markup}math\n${token.content}${token.markup}`;
    return draw(mathFenceSource(raw, token.content), env);
  };
}
