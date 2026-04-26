/**
 * Feishu / Lark outbound text formatting.
 *
 * Agent output is often Markdown. Feishu card markdown (`tag: markdown`) expects
 * Lark-flavored Markdown (bold/italic/strikethrough, links, code fences, etc.), not
 * CommonMark-only constructs like `**bold**` left uninterpreted in plain `text`
 * messages — and plain text messages do not render Markdown at all.
 *
 * Pipeline mirrors Telegram: Markdown → shared IR → channel-specific rendering.
 */

import {
  markdownToIR,
  renderMarkdownWithMarkers,
  type MarkdownLinkSpan,
  type RenderStyleMap,
} from '@xopcai/xopc/markdown/index.js';

import type { MarkdownTableMode } from '@xopcai/xopc/config/types.base.js';

const FEISHU_STYLE_MARKERS: RenderStyleMap = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  strikethrough: { open: '~~', close: '~~' },
  code: { open: '`', close: '`' },
  code_block: { open: '```\n', close: '\n```' },
  // Lark markdown supports `> ...` block quotes; IR text omits leading `>`.
  blockquote: { open: '> ', close: '' },
};

function escapeFeishuMarkdownPlain(text: string): string {
  // Lark docs: escape markdown metacharacters with HTML entities when needed.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*/g, '&#42;')
    .replace(/_/g, '&#95;')
    .replace(/~/g, '&#126;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/`/g, '&#96;');
}

function buildFeishuLinkRenderer(
  _irText: string
): (link: MarkdownLinkSpan, text: string) => { start: number; end: number; open: string; close: string } | null {
  return (link, _text) => {
    const href = link.href.trim();
    if (!href) return null;

    const allowedSchemes = /^(https?|mailto):/i;
    if (!allowedSchemes.test(href) && !href.startsWith('#')) {
      return null;
    }

    // Lark examples commonly use `<https://...>` for bare URLs; labeled links use markdown syntax.
    const isBareUrl = _text.trim() === href;
    if (isBareUrl) {
      return {
        start: link.start,
        end: link.end,
        open: '<',
        close: `>`,
      };
    }

    return {
      start: link.start,
      end: link.end,
      open: '[',
      close: `](${href})`,
    };
  };
}

export function renderFeishuCardMarkdown(
  markdown: string,
  options: { tableMode?: MarkdownTableMode } = {}
): string {
  const ir = markdownToIR(markdown, {
    linkify: true,
    enableSpoilers: false,
    tableMode: options.tableMode ?? 'bullets',
  });

  return renderMarkdownWithMarkers(ir, {
    styleMarkers: FEISHU_STYLE_MARKERS,
    escapeText: escapeFeishuMarkdownPlain,
    buildLink: buildFeishuLinkRenderer(ir.text),
  });
}

export function markdownToFeishuPlainText(markdown: string): string {
  const ir = markdownToIR(markdown, {
    linkify: true,
    enableSpoilers: false,
    tableMode: 'bullets',
  });

  let result = ir.text;
  const sortedLinks = [...ir.links].toSorted((a, b) => b.start - a.start);
  for (const link of sortedLinks) {
    const linkText = ir.text.slice(link.start, link.end);
    const replacement = `${linkText} (${link.href})`;
    result = result.slice(0, link.start) + replacement + result.slice(link.end);
  }

  return result;
}

export function formatFeishuOutboundText(input: {
  text: string;
  renderMode?: 'auto' | 'raw' | 'card';
  /** When true, target is Feishu interactive markdown (card / card element). */
  forCardMarkdown: boolean;
}): string {
  const raw = input.text ?? '';
  if (!raw.trim()) return raw;

  if (input.renderMode === 'raw') {
    return raw;
  }

  if (input.forCardMarkdown) {
    return renderFeishuCardMarkdown(raw);
  }

  return markdownToFeishuPlainText(raw);
}
