import type { Root as MdRoot, RootContent as MdContent } from 'mdast';
import type { Root, Element, Text } from 'hast';
import { SKIP, visitParents } from 'unist-util-visit-parents';

import { collectFileMentionMatches, parseWorkspaceFileLinkTarget } from '@/components/markdown/internal-links';
import { resolveAppLink } from '@/lib/app-link';

function fileHref(path: string, line?: number): string {
  const params = new URLSearchParams({ path });
  if (line) params.set('line', String(line));
  return `/xopc/workspace/file?${params}`;
}

function normalizeHref(href: string, appLinks: boolean): string {
  if (appLinks) {
    const intent = resolveAppLink(href);
    if (intent.kind === 'internal-route') return `#${intent.route}`;
    if (href.startsWith('#')) return href;
  }
  const target = parseWorkspaceFileLinkTarget(href);
  return target ? fileHref(target.path, target.line) : href;
}

/** Normalize resolved links before sanitization, so reference images keep file semantics. */
export function rehypeChatLinks() {
  return (tree: Root) => {
    visitParents(tree, 'element', (node: Element) => {
      if (node.tagName === 'a' && typeof node.properties.href === 'string') {
        node.properties.href = normalizeHref(node.properties.href, true);
      } else if (node.tagName === 'img' && typeof node.properties.src === 'string') {
        node.properties.src = normalizeHref(node.properties.src, false);
      }
    });
  };
}

/** Keep app links and literal HTML in the syntax tree, including escaped xopc links. */
export function remarkChatContent({ breaks = false }: { breaks?: boolean } = {}) {
  return (tree: MdRoot) => {
    visitParents(tree, (node, ancestors) => {
      if (node.type === 'html') {
        const parent = ancestors.at(-1);
        if (parent && 'children' in parent) {
          const index = parent.children.indexOf(node as never);
          parent.children.splice(index, 1, { type: 'text', value: node.value } as never);
        }
        return SKIP;
      }
      if (node.type !== 'text' || ancestors.some(n => n.type === 'link')) return;
      const matches = Array.from(node.value.matchAll(/\[([^\]\n]+)\]\((xopc:\/\/[^\s<>]+?)\)|xopc:\/\/[^\s<>\[\]()"'，。；！？、]+/gi));
      if (!matches.length && !(breaks && node.value.includes('\n'))) return;
      const output: MdContent[] = [];
      const appendText = (value: string) => {
        const lines = breaks ? value.split('\n') : [value];
        lines.forEach((line, i) => {
          if (i) output.push({ type: 'break' });
          if (line) output.push({ type: 'text', value: line });
        });
      };
      let cursor = 0;
      for (const match of matches) {
        const raw = match[0].replace(/[.,;!?]+$/, '');
        appendText(node.value.slice(cursor, match.index));
        output.push({ type: 'link', url: match[2] ?? raw, children: [{ type: 'text', value: match[1] ?? raw }] });
        cursor = match.index + raw.length;
      }
      appendText(node.value.slice(cursor));
      const parent = ancestors.at(-1);
      if (parent && 'children' in parent) {
        parent.children.splice(parent.children.indexOf(node as never), 1, ...output as never[]);
        return SKIP;
      }
    });
  };
}

export function rehypeChatFileMentions() {
  return (tree: Root) => {
    visitParents(tree, 'text', (node: Text, ancestors) => {
      if (ancestors.some(n => n.type === 'element' && (['a', 'pre', 'code', 'kbd', 'samp', 'math', 'annotation'].includes(n.tagName) || (n.properties.dataXopcMath !== undefined || n.properties['data-xopc-math'] !== undefined)))) return;
      const matches = collectFileMentionMatches(node.value);
      if (!matches.length) return;
      const parent = ancestors.at(-1);
      if (!parent || !('children' in parent)) return;
      const nodes: (Element | Text)[] = [];
      let cursor = 0;
      for (const match of matches) {
        if (match.start > cursor) nodes.push({ type: 'text', value: node.value.slice(cursor, match.start) });
        nodes.push({ type: 'element', tagName: 'a', properties: {
          href: fileHref(match.target.path, match.target.line), className: ['markdown-file-link'],
        }, children: [{ type: 'text', value: match.raw }] });
        cursor = match.end;
      }
      if (cursor < node.value.length) nodes.push({ type: 'text', value: node.value.slice(cursor) });
      parent.children.splice(parent.children.indexOf(node), 1, ...nodes);
      return SKIP;
    });
  };
}


/** Scope generated fragment IDs to this message and repair sanitizer-prefixed references. */
export function rehypeChatFragments({ prefix }: { prefix: string }) {
  return (tree: Root) => {
    const ids = new Map<string, string>();
    visitParents(tree, 'element', (node: Element) => {
      if (typeof node.properties.id !== 'string') return;
      const original = node.properties.id;
      const id = `${prefix}-${original}`;
      ids.set(original, id);
      if (original.startsWith('user-content-')) ids.set(original.slice('user-content-'.length), id);
      node.properties.id = id;
    });
    visitParents(tree, 'element', (node: Element) => {
      if (typeof node.properties.href === 'string' && node.properties.href.startsWith('#') && !node.properties.href.startsWith('#/')) {
        const destination = ids.get(node.properties.href.slice(1));
        if (destination) node.properties.href = `#${destination}`;
      }
      for (const property of ['ariaDescribedBy', 'ariaLabelledBy']) {
        const value = node.properties[property];
        if (Array.isArray(value)) node.properties[property] = value.map(id => ids.get(String(id)) ?? id);
      }
    });
  };
}
