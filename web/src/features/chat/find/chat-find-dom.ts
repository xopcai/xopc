export type ChatFindDomMatch = {
  messageIndex: number;
  occurrence: number;
  range: Range;
};

type TextSpan = {
  node: Text;
  start: number;
  end: number;
};

const MATCH_HIGHLIGHT = 'chat-find-match';
const ACTIVE_HIGHLIGHT = 'chat-find-active';
const HIGHLIGHT_STYLE_ID = 'chat-find-highlight-styles';

type HighlightRegistry = {
  delete(name: string): void;
  set(name: string, highlight: unknown): void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function highlightRuntime(): { registry: HighlightRegistry; Highlight: HighlightConstructor } | null {
  const css = globalThis.CSS as (typeof CSS & { highlights?: HighlightRegistry }) | undefined;
  const Highlight = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor }).Highlight;
  if (!css?.highlights || !Highlight) return null;
  return { registry: css.highlights, Highlight };
}

function ensureHighlightStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    ::highlight(${MATCH_HIGHLIGHT}) {
      color: inherit;
      background-color: color-mix(in srgb, var(--color-warning) 38%, transparent);
    }
    ::highlight(${ACTIVE_HIGHLIGHT}) {
      color: inherit;
      background-color: color-mix(in srgb, var(--color-warning) 78%, transparent);
      text-decoration: underline 2px var(--color-fg);
    }
  `;
  document.head.appendChild(style);
}

function searchableTextNodes(scope: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.textContent || !parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('button, [hidden], [aria-hidden="true"], .sr-only, script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function rangeForOffsets(spans: readonly TextSpan[], start: number, end: number): Range | null {
  const startSpan = spans.find((span) => span.end > start);
  const endSpan = [...spans].reverse().find((span) => span.start < end);
  if (!startSpan || !endSpan) return null;
  const range = document.createRange();
  range.setStart(startSpan.node, start - startSpan.start);
  range.setEnd(endSpan.node, end - endSpan.start);
  return range;
}

function literalOffsets(text: string, query: string): Array<{ start: number; end: number }> {
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  if (!needle) return [];
  const offsets: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) break;
    offsets.push({ start, end: start + needle.length });
    from = start + Math.max(needle.length, 1);
  }
  return offsets;
}

export function collectChatFindMatches(root: HTMLElement, query: string): ChatFindDomMatch[] {
  const normalized = query.trim();
  if (!normalized) return [];
  const matches: ChatFindDomMatch[] = [];
  const rows = root.querySelectorAll<HTMLElement>('[data-chat-message-index]');
  for (const row of rows) {
    const rawIndex = row.dataset.chatMessageIndex;
    const messageIndex = rawIndex ? Number.parseInt(rawIndex, 10) : NaN;
    if (!Number.isFinite(messageIndex)) continue;
    let occurrence = 0;
    for (const scope of row.querySelectorAll<HTMLElement>('[data-chat-find-text]')) {
      const nodes = searchableTextNodes(scope);
      const spans: TextSpan[] = [];
      let text = '';
      for (const node of nodes) {
        const value = node.textContent ?? '';
        const start = text.length;
        text += value;
        spans.push({ node, start, end: text.length });
      }
      for (const offset of literalOffsets(text, normalized)) {
        const range = rangeForOffsets(spans, offset.start, offset.end);
        if (!range) continue;
        matches.push({ messageIndex, occurrence, range });
        occurrence += 1;
      }
    }
  }
  return matches;
}

export function renderChatFindHighlights(
  matches: readonly ChatFindDomMatch[],
  activeIndex: number,
): void {
  const runtime = highlightRuntime();
  if (!runtime) return;
  ensureHighlightStyles();
  runtime.registry.delete(MATCH_HIGHLIGHT);
  runtime.registry.delete(ACTIVE_HIGHLIGHT);
  if (matches.length === 0) return;
  runtime.registry.set(MATCH_HIGHLIGHT, new runtime.Highlight(...matches.map((match) => match.range)));
  const active = matches[activeIndex];
  if (active) runtime.registry.set(ACTIVE_HIGHLIGHT, new runtime.Highlight(active.range));
}

export function clearChatFindHighlights(): void {
  const runtime = highlightRuntime();
  runtime?.registry.delete(MATCH_HIGHLIGHT);
  runtime?.registry.delete(ACTIVE_HIGHLIGHT);
}

export function scrollChatFindMatchIntoView(
  viewport: HTMLElement,
  match: ChatFindDomMatch,
  topInset = 96,
): void {
  const target = match.range.getBoundingClientRect();
  const bounds = viewport.getBoundingClientRect();
  const top = bounds.top + topInset;
  const bottom = bounds.bottom - 24;
  if (target.top >= top && target.bottom <= bottom) return;
  viewport.scrollTo({
    top: Math.max(0, viewport.scrollTop + target.top - top),
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
