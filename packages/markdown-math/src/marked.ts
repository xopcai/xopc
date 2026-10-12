import type { MarkedExtension, Tokens } from 'marked';

import { mathPlaceholder, readDisplayMathAt, readInlineMathAt } from './syntax';
import type { MathSource } from './types';

interface MathToken extends Tokens.Generic { source: MathSource; }
export const markedMath: MarkedExtension = {
  walkTokens(token) {
    if (token.type !== 'image') return;
    function plainLabel(child: Tokens.Generic) {
      if (child.type === 'xopcMathInline') {
        child.type = 'text'; child.text = (child as MathToken).source.raw; child.escaped = false;
      }
      for (const nested of (child.tokens ?? []) as Tokens.Generic[]) plainLabel(nested);
    }
    for (const child of (token as Tokens.Image).tokens ?? []) plainLabel(child);
  },
  extensions: [
  { name: 'xopcMathBlock', level: 'block',
    start: src => { const at = src.search(/(?:^|\n) {0,3}(?:\\\[|\$\$)/); return at < 0 ? undefined : at; },
    tokenizer(src) {
      const source = readDisplayMathAt(src);
      if (!source) return;
      return { type: 'xopcMathBlock', raw: source.raw, source };
    },
    renderer(token) { return mathPlaceholder((token as MathToken).source); },
  },
  { name: 'xopcMathInline', level: 'inline',
    start: src => { const at = src.search(/\\\(|\$/); return at < 0 ? undefined : at; },
    tokenizer(src) {
      const source = readInlineMathAt(src);
      if (!source) return;
      return { type: 'xopcMathInline', raw: source.raw, source };
    },
    renderer(token) { return mathPlaceholder((token as MathToken).source); },
  },
] };
