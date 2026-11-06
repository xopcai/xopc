import type { Root as MdRoot, RootContent as MdContent } from 'mdast';
import type { Root, Element, Text } from 'hast';
import LinkifyIt from 'linkify-it';
import { SKIP, visitParents } from 'unist-util-visit-parents';

import { collectFileMentionMatches, parseWorkspaceFileLinkTarget } from '@/components/markdown/internal-links';
import { resolveAppLink } from '@/lib/app-link';

const webLinkifier = new LinkifyIt().tlds(['app', 'cloud', 'dev', 'online', 'site', 'tech', 'xyz'], true);

function bareWebLinks(text: string) {
  // Treat CJK sentence punctuation as a boundary while preserving the match offsets.
  const matches = webLinkifier.match(text.replace(/[，。；！？、：（）【】《》「」『』]/g, ' '));
  return (matches ?? []).flatMap(match => {
    if (match.schema !== '') return [];
    try {
      const url = new URL(`https://${match.raw}`);
      // Some top-level domains overlap with file extensions (for example, .md).
      if (parseWorkspaceFileLinkTarget(url.hostname)) return [];
      return [{ start: match.index, end: match.lastIndex, label: match.raw, url: url.href }];
    } catch {
      return [];
    }
  });
}

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
    const [webLink] = bareWebLinks(href);
    if (webLink?.start === 0 && webLink.end === href.length) return webLink.url;
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

/** Resolve bare web and app links before workspace file detection. */
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
      if (node.type !== 'text' || ancestors.some(n => n.type === 'link' || n.type === 'linkReference')) return;
      const appLinks = Array.from(node.value.matchAll(/\[([^\]\n]+)\]\((xopc:\/\/[^\s<>]+?)\)|xopc:\/\/[^\s<>\[\]()"'，。；！？、]+/gi), match => {
        const raw = match[0].replace(/[.,;!?]+$/, '');
        return { start: match.index, end: match.index + raw.length, url: match[2] ?? raw, label: match[1] ?? raw };
      });
      const matches = [...appLinks, ...bareWebLinks(node.value)].sort((a, b) => a.start - b.start);
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
        if (match.start < cursor) continue;
        appendText(node.value.slice(cursor, match.start));
        output.push({ type: 'link', url: match.url, children: [{ type: 'text', value: match.label }] });
        cursor = match.end;
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
