import { fromMarkdown, type Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type { Processor } from 'unified';
import type { Construct, Extension, State, Tokenizer } from 'micromark-util-types';

import { encodeMathSource, mathFenceSource, readDisplayMathAt, readInlineMathAt, isEscaped, readMathFenceAt } from './syntax';
import type { MathSource } from './types';

declare module 'micromark-util-types' {
  interface TokenTypeMap { xopcMathInline: 'xopcMathInline'; xopcMathFlow: 'xopcMathFlow'; xopcMathValue: 'xopcMathValue'; }
}

function character(code: number): string {
  return code === -5 || code === -4 || code === -3 ? '\n' : code < 0 ? ' ' : String.fromCharCode(code);
}

const nonLazy: Construct = { partial: true, tokenize(effects, ok, nok) {
  const context = this;
  return code => {
    if (code === null) return ok(code);
    effects.enter('lineEnding'); effects.consume(code); effects.exit('lineEnding');
    return next => context.parser.lazy[context.now().line] ? nok(next) : ok(next);
  };
} };

function tokenizer(display: boolean): Tokenizer {
  return function(effects, ok, nok) {
    const context = this;
    let raw = '';
    let closed = false;
    let comment = false;
    let valueOpen = false;
    const type = display ? 'xopcMathFlow' : 'xopcMathInline';
    return start;
    function start(code: number | null): ReturnType<State> {
      effects.enter(type);
      return consume(code);
    }
    function finish(code: number | null): ReturnType<State> {
      const source = display ? readDisplayMathAt(raw) : readInlineMathAt(raw);
      if (!source) return nok(code);
      if (valueOpen) effects.exit('xopcMathValue');
      effects.exit(type);
      return ok(code);
    }
    function consume(code: number | null): ReturnType<State> {
      if (code === null) return finish(code);
      const char = character(code);
      if (char === '\n') {
        if (display && context.interrupt) return finish(code);
        if (!display || closed) return finish(code);
        if (valueOpen) effects.exit('xopcMathValue');
        valueOpen = false;
        return effects.attempt(nonLazy, next => {
          raw += '\n'; comment = false; return consume(next);
        }, next => finish(next))(code);
      }
      if (closed) {
        if (!display) return /\d/.test(char) && raw.startsWith('$') ? nok(code) : finish(code);
        if (char !== ' ' && char !== '\t') return nok(code);
      }
      if (!valueOpen) { effects.enter('xopcMathValue'); valueOpen = true; }
      effects.consume(code);
      raw += char;
      if (char === '\n') comment = false;
      if (char === '%' && !isEscaped(raw, raw.length - 1)) comment = true;
      if (raw.length === 1 && char === '\\') return consume;
      if (raw.length === 2 && raw.startsWith('\\') && raw !== (display ? '\\[' : '\\(')) return nok;
      if (!display && raw.startsWith('$$')) return nok;
      if (display && raw.startsWith('$') && raw.length === 2 && raw !== '$$') return nok;
      const closer = raw.startsWith('\\') ? (display ? '\\]' : '\\)') : display ? '$$' : '$';
      const width = closer.length;
      closed = !comment && raw.length >= width * 2 && raw.endsWith(closer) && !isEscaped(raw, raw.length - width);
      return consume;
    }
  };
}

const inline: Construct = { name: 'xopcMathInline', tokenize: tokenizer(false) };
const flow: Construct = { name: 'xopcMathFlow', tokenize: tokenizer(true), concrete: true };
export const mathSyntax: Extension = { text: { 92: inline, 36: inline }, flow: { 92: flow, 36: flow } };

function mathData(source: MathSource) {
  return { hName: 'code', hProperties: { className: [source.display ? 'math-display' : 'math-inline'],
    'data-xopc-math-source': encodeMathSource(source) }, hChildren: [{ type: 'text' as const, value: source.raw }] };
}
export const mathFromMarkdown: FromMarkdownExtension = {
  enter: {
    xopcMathInline(token) { this.enter({ type: 'inlineCode', value: '' }, token); },
    xopcMathFlow(token) { this.enter({ type: 'code', value: '' }, token); },
  },
  exit: {
    xopcMathInline(token) {
      const raw = this.sliceSerialize(token);
      const node = this.stack[this.stack.length - 1];
      const source = readInlineMathAt(raw)!;
      Object.assign(node, { value: raw, data: mathData(source) });
      this.exit(token);
    },
    xopcMathFlow(token) {
      const raw = this.sliceSerialize(token);
      const node = this.stack[this.stack.length - 1];
      const source = readDisplayMathAt(raw)!;
      Object.assign(node, { value: raw, data: mathData(source) });
      this.exit(token);
    },
  },
};

/** Registers syntax before Markdown escapes; the transformer only handles explicit math fences. */
export function remarkXopcMath(this: Processor) {
  const data = this.data() as { micromarkExtensions?: Extension[]; fromMarkdownExtensions?: FromMarkdownExtension[] };
  (data.micromarkExtensions ??= []).push(mathSyntax);
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown);
  return (tree: { children: unknown[] }, file: { value: unknown }) => {
    function walk(node: { type?: string; lang?: string; value?: string; data?: unknown; position?: { start: { offset?: number }; end: { offset?: number } }; children?: unknown[] }) {
      if (node.type === 'code' && node.lang === 'math') {
        const latex = node.value ?? '';
        const raw = String(file.value).slice(node.position?.start.offset, node.position?.end.offset);
        node.data = mathData(readMathFenceAt(raw) ?? mathFenceSource(raw, latex));
      }
      for (const child of node.children ?? []) walk(child as Parameters<typeof walk>[0]);
    }
    walk(tree);
  };
}

const rangeCache = new Map<string, Array<{ start: number; end: number }>>();
let rangeCacheLength = 0;
export function mathRanges(markdown: string): Array<{ start: number; end: number }> {
  if (!/\\[([]|\$|^\s*```math/m.test(markdown)) return [];
  const cached = rangeCache.get(markdown);
  if (cached) return cached;
  const tree = fromMarkdown(markdown, { extensions: [mathSyntax], mdastExtensions: [mathFromMarkdown] });
  const ranges: Array<{ start: number; end: number }> = [];
  function walk(node: { type?: string; lang?: string; data?: { hProperties?: unknown }; position?: { start: { offset?: number }; end: { offset?: number } }; children?: unknown[] }) {
    if (node.type === 'image' || node.type === 'html') return;
    if (node.data?.hProperties || (node.type === 'code' && node.lang === 'math')) {
      const start = node.position?.start.offset; const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
    }
    for (const child of node.children ?? []) walk(child as Parameters<typeof walk>[0]);
  }
  walk(tree);
  if (markdown.length <= 262_144) {
    while (rangeCache.size >= 256 || rangeCacheLength + markdown.length > 1_048_576) {
      const key = rangeCache.keys().next().value!;
      rangeCacheLength -= key.length; rangeCache.delete(key);
    }
    rangeCache.set(markdown, ranges); rangeCacheLength += markdown.length;
  }
  return ranges;
}
