import type { Root, Element, Text } from 'hast';
import { createContext, useContext, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { SKIP, visitParents } from 'unist-util-visit-parents';

import { graphemeCommitBoundary, splitRevealText } from './text-segments';
export { graphemeCommitBoundary, splitRevealText } from './text-segments';

export const REVEAL_DURATION_MS = 700;
const MAX_ACTIVE_SEGMENTS = 256;

export type RevealLedger = { length: number; starts: Map<number, number> };
export const RevealLedgerContext = createContext<RevealLedger | null>(null);
export const RevealBudgetContext = createContext<Set<Animation> | null>(null);

/** Animation starts are committed in effects, never during AST transformation. */
export function RevealSpan({ node: _node, ...props }: ComponentProps<'span'> & { node?: unknown }) {
  const ledger = useContext(RevealLedgerContext);
  const budget = useContext(RevealBudgetContext);
  const ref = useRef<HTMLSpanElement>(null);
  const id = Number((props as Record<string, unknown>)['data-xopc-segment']);
  const newValue = (props as Record<string, unknown>)['data-xopc-new'];
  const isNew = newValue === true || newValue === 'true';
  useLayoutEffect(() => {
    const element = ref.current;
    if (!ledger || !element?.animate || document.visibilityState === 'hidden'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (budget && budget.size >= MAX_ACTIVE_SEGMENTS) return;
    const now = performance.now();
    const previous = ledger.starts.get(id);
    if (previous === undefined && !isNew) return;
    if (previous === undefined) {
      if (ledger.starts.size >= MAX_ACTIVE_SEGMENTS) return;
      ledger.starts.set(id, now);
    }
    const elapsed = now - (previous ?? now);
    if (elapsed >= REVEAL_DURATION_MS) return;
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: REVEAL_DURATION_MS, easing: 'cubic-bezier(.37,.55,.86,.88)', fill: 'both',
    });
    animation.currentTime = elapsed;
    budget?.add(animation);
    const release = () => { animation.cancel(); budget?.delete(animation); };
    animation.onfinish = release;
    return release;
  }, [id, ledger, budget]); // A reused span keeps its animation while its text grows.
  return <span {...props} ref={ref} />;
}

export function createRevealPlugin(ledger: RevealLedger, animate: boolean, initial: boolean, budget: Set<Animation>, blockId: string) {
  const plugin = () => (tree: Root) => {
    const enabled = animate && document.visibilityState !== 'hidden'
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let cursor = 0;
    let units = 0;
    const available = MAX_ACTIVE_SEGMENTS - (budget?.size ?? 0);
    const now = performance.now();
    visitParents(tree, 'text', (node: Text, ancestors) => {
      if (ancestors.some(n => n.type === 'element' && (['pre', 'svg', 'math', 'annotation'].includes(n.tagName)
        || (n.properties.dataXopcMath !== undefined || n.properties['data-xopc-math'] !== undefined)
        || n.properties['data-xopc-segment'] !== undefined))) return;
      const start = cursor;
      cursor += node.value.length;
      if (!enabled) return;
      const parent = ancestors.at(-1);
      if (!parent || !('children' in parent)) return;
      const output: (Text | Element)[] = [];
      const segments = splitRevealText(node.value).flatMap(segment => {
        const boundary = ledger.length - start - segment.offset;
        if (boundary <= 0 || boundary >= segment.text.length) return [segment];
        const cut = graphemeCommitBoundary(segment.text, boundary);
        if (cut >= segment.text.length) return [segment];
        return [{ text: segment.text.slice(0, cut), offset: segment.offset },
          { text: segment.text.slice(cut), offset: segment.offset + cut }];
      });
      for (const segment of segments) {
        const id = start + segment.offset;
        const isNew = !initial && id >= ledger.length;
        const at = ledger.starts.get(id);
        const active = at !== undefined && now - at < REVEAL_DURATION_MS;
        if ((!isNew && !active) || !segment.text.trim() || (isNew && !active && units++ >= available)) {
          const previous = output.at(-1);
          if (previous?.type === 'text') previous.value += segment.text;
          else output.push({ type: 'text', value: segment.text });
        } else output.push({ type: 'element', tagName: 'span', properties: {
          'data-xopc-segment': id, 'data-xopc-new': isNew,
        }, children: [{ type: 'text', value: segment.text }] });
      }
      const index = parent.children.indexOf(node);
      parent.children.splice(index, 1, ...output);
      // Generated whitespace/text siblings must not be counted a second time.
      return [SKIP, index + output.length];
    });
    tree.children.push({ type: 'element', tagName: 'span', properties: {
      hidden: true, 'data-xopc-watermark': cursor,
    }, children: [] });
  };
  // Streamdown caches processors by plugin name; closures from different blocks must never collide.
  Object.defineProperty(plugin, 'name', { value: `xopcReveal-${blockId}-${animate}-${initial}` });
  return plugin;
}
