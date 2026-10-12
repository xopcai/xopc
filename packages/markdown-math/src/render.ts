import katex from 'katex';

import { MAX_CACHE_BYTES, MAX_CACHE_ENTRIES, MAX_MATH_LENGTH, MATH_POLICY_VERSION } from './policy';
import { encodeMathSource, escapeHtml } from './syntax';
import type { MathRenderContext, MathRenderResult, MathSource } from './types';

const cache = new Map<string, { result: MathRenderResult; bytes: number }>();
let cacheBytes = 0;
export function renderMath(source: MathSource, context: MathRenderContext = { streaming: false }): MathRenderResult {
  if (source.latex.length > MAX_MATH_LENGTH) return { status: 'fallback', reason: 'limit', source: source.raw };
  if (source.state === 'pending') return context.streaming ? { status: 'pending' }
    : { status: 'fallback', reason: 'invalid', source: source.raw };
  const key = `${katex.version}:${MATH_POLICY_VERSION}:${source.display}:${source.latex}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key); cache.set(key, cached);
    return cached.result.status === 'fallback' ? { ...cached.result, source: source.raw } : cached.result;
  }
  let result: MathRenderResult;
  try {
    result = { status: 'ready', html: katex.renderToString(source.latex, {
      displayMode: source.display, output: 'htmlAndMathml', trust: false, throwOnError: true,
      strict: 'ignore', maxExpand: 1000, maxSize: 20, globalGroup: false, macros: {},
    }) };
  } catch { result = { status: 'fallback', reason: 'invalid', source: source.raw }; }
  const bytes = (key.length + (result.status === 'ready' ? result.html.length : source.raw.length)) * 2;
  if (bytes <= MAX_CACHE_BYTES) {
    while (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + bytes > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
    }
    cache.set(key, { result, bytes }); cacheBytes += bytes;
  }
  return result;
}

export function renderMathHtml(source: MathSource, context: MathRenderContext = { streaming: false }, limited = false): string {
  const result = limited ? { status: 'fallback' as const, reason: 'limit', source: source.raw } : renderMath(source, context);
  const tag = source.display ? 'div' : 'span';
  const body = result.status === 'ready' ? result.html : `<span class="markdown-math-source">${escapeHtml(source.raw)}</span>`;
  return `<${tag} class="markdown-math ${source.display ? 'markdown-math-display' : 'markdown-math-inline'}" data-xopc-math="${result.status}" data-xopc-math-source="${escapeHtml(encodeMathSource(source))}">${body}</${tag}>`;
}

export function mathCacheStats(): { entries: number; bytes: number } { return { entries: cache.size, bytes: cacheBytes }; }
