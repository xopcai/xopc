/**
 * Outbound Markdown formatting for enterprise channels (DingTalk, Slack, WeCom, Discord).
 *
 * Converts agent CommonMark output through the shared `src/markdown` IR into each
 * platform's supported markup while rejecting unsafe link schemes/credentials and
 * keeping chunks within provider payload limits.
 */

import {
  chunkMarkdownIR,
  chunkText,
  markdownToIR,
  markdownToIRWithMeta,
  parseFenceSpans,
  renderMarkdownWithMarkers,
  type MarkdownIR,
  type MarkdownLinkSpan,
  type RenderLink,
  type RenderStyleMap,
} from '../../markdown/index.js';

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Validate a link href so outbound messages only emit clickable anchors for
 * safe protocols without embedded credentials.
 */
export function sanitizeOutboundHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;
  try {
    const parsed = new URL(href);
    if (!SAFE_LINK_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return href;
  } catch {
    return null;
  }
}

function escapeMarkdownHref(href: string): string {
  return href
    .replace(/\s+/g, (ws) => encodeURIComponent(ws))
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function buildMarkdownLink(link: MarkdownLinkSpan, irText: string): RenderLink | null {
  const safeHref = sanitizeOutboundHref(link.href);
  if (!safeHref) return null;
  const label = irText.slice(link.start, link.end);
  if (!label.trim()) return null;
  if (label.trim() === safeHref) {
    return null;
  }
  return {
    start: link.start,
    end: link.end,
    open: '[',
    close: `](${escapeMarkdownHref(safeHref)})`,
  };
}

/**
 * Prefix every line inside a `blockquote` span so multi-line quotes stay quoted
 * in line-oriented Markdown renderers (DingTalk, Slack, WeCom).
 */
function renderWithLinePrefixedBlockquotes(
  ir: MarkdownIR,
  options: {
    styleMarkers: RenderStyleMap;
    escapeText: (text: string) => string;
    buildLink?: (link: MarkdownLinkSpan, text: string) => RenderLink | null;
  },
): string {
  const quoteSpans = ir.styles.filter((span) => span.style === 'blockquote');
  if (quoteSpans.length === 0) {
    return renderMarkdownWithMarkers(ir, options);
  }

  // Render blockquote spans with placeholder sentinels so we can safely prefix
  // every line inside each blockquote after text escaping has run.
  const openSentinel = '\u0000BQ_OPEN\u0000';
  const closeSentinel = '\u0000BQ_CLOSE\u0000';
  const rendered = renderMarkdownWithMarkers(ir, {
    ...options,
    styleMarkers: {
      ...options.styleMarkers,
      blockquote: { open: openSentinel, close: closeSentinel },
    },
  });

  return rendered.replace(
    new RegExp(`${openSentinel}([\\s\\S]*?)${closeSentinel}`, 'g'),
    (_match, inner: string) => {
      const trailingMatch = inner.match(/\n+$/);
      const trailing = trailingMatch ? trailingMatch[0] : '';
      const body = trailing ? inner.slice(0, -trailing.length) : inner;
      const quoted = body
        .split('\n')
        .map((line) => (line.length > 0 ? `> ${line}` : '>'))
        .join('\n');
      return `${quoted}${trailing}`;
    },
  );
}

/**
 * DingTalk `sampleMarkdown` follows strict CommonMark soft-break collapsing, where
 * a single `\n` between lines (such as `• item` lines) can merge onto one line.
 * Insert two trailing spaces before single newlines outside fenced code blocks.
 */
function addHardLineBreaksOutsideFences(markdown: string): string {
  const spans = parseFenceSpans(markdown);
  let out = '';
  let i = 0;
  while (i < markdown.length) {
    const ch = markdown[i];
    if (ch === '\n') {
      const inFence = spans.some((span) => i > span.start && i < span.end);
      const prev = i > 0 ? markdown[i - 1] : '';
      const next = i + 1 < markdown.length ? markdown[i + 1] : '';
      const isSingleBreak = prev !== '\n' && next !== '\n' && next !== '';
      if (!inFence && isSingleBreak && !out.endsWith('  ')) {
        out += '  \n';
      } else {
        out += '\n';
      }
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

/**
 * Derive a clean plain-text preview title for DingTalk `sampleMarkdown.title`.
 */
export function extractPlainPreviewTitle(plainText: string, maxChars = 60, fallback = 'xopc'): string {
  const firstLine = plainText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find((line) => line.length > 0);
  if (!firstLine) return fallback;
  const chars = Array.from(firstLine);
  if (chars.length <= maxChars) return firstLine;
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

// ---------------------------------------------------------------------------
// DingTalk (`sampleMarkdown`: { title, text })
// ---------------------------------------------------------------------------

const DINGTALK_STYLE_MARKERS: RenderStyleMap = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  code: { open: '`', close: '`' },
  code_block: { open: '```\n', close: '```' },
};

export interface DingTalkMarkdownPayload {
  title: string;
  text: string;
}

export function formatDingTalkOutboundMessages(
  markdown: string,
  limit = 3800,
): DingTalkMarkdownPayload[] {
  if (!markdown?.trim()) return [];
  const ir = markdownToIR(markdown, {
    linkify: true,
    enableSpoilers: false,
    headingStyle: 'bold',
    tableMode: 'bullets',
  });
  if (!ir.text.trim()) return [];
  const chunks = chunkMarkdownIR(ir, limit);
  return chunks
    .map((chunk) => {
      const rendered = renderWithLinePrefixedBlockquotes(chunk, {
        styleMarkers: DINGTALK_STYLE_MARKERS,
        escapeText: (text) => text,
        buildLink: buildMarkdownLink,
      }).trim();
      if (!rendered) return null;
      return {
        title: extractPlainPreviewTitle(chunk.text),
        text: addHardLineBreaksOutsideFences(rendered),
      };
    })
    .filter((item): item is DingTalkMarkdownPayload => item !== null);
}

// ---------------------------------------------------------------------------
// Slack (`mrkdwn: true`)
// ---------------------------------------------------------------------------

const SLACK_STYLE_MARKERS: RenderStyleMap = {
  bold: { open: '*', close: '*' },
  italic: { open: '_', close: '_' },
  strikethrough: { open: '~', close: '~' },
  code: { open: '`', close: '`' },
  code_block: { open: '```\n', close: '```' },
};

/**
 * Slack `mrkdwn` requires `&`, `<`, `>` to be HTML-entity escaped across all
 * text so user/LLM text cannot spoof mentions (`<!channel>`, `<@U...>`) or links.
 */
export function escapeSlackMrkdwn(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeSlackHref(href: string): string {
  return escapeSlackMrkdwn(
    href
      .replace(/\s+/g, (ws) => encodeURIComponent(ws))
      .replace(/\|/g, '%7C'),
  );
}

function buildSlackLink(link: MarkdownLinkSpan, irText: string): RenderLink | null {
  const safeHref = sanitizeOutboundHref(link.href);
  if (!safeHref) return null;
  const label = irText.slice(link.start, link.end);
  if (!label.trim()) return null;
  if (label.trim() === safeHref) {
    // A bare URL containing `|` would be parsed by Slack as `<url|label>` spoofing.
    if (safeHref.includes('|')) return null;
    return {
      start: link.start,
      end: link.end,
      open: '<',
      close: '>',
    };
  }
  return {
    start: link.start,
    end: link.end,
    open: `<${escapeSlackHref(safeHref)}|`,
    close: '>',
  };
}

export function formatSlackOutboundMrkdwn(markdown: string): string {
  if (!markdown?.trim()) return '';
  const ir = markdownToIR(markdown, {
    linkify: true,
    enableSpoilers: false,
    headingStyle: 'bold',
    tableMode: 'bullets',
  });
  return renderWithLinePrefixedBlockquotes(ir, {
    styleMarkers: SLACK_STYLE_MARKERS,
    escapeText: escapeSlackMrkdwn,
    buildLink: buildSlackLink,
  }).trim();
}

export function formatSlackOutboundChunks(markdown: string, limit = 3800): string[] {
  if (!markdown?.trim()) return [];
  const ir = markdownToIR(markdown, {
    linkify: true,
    enableSpoilers: false,
    headingStyle: 'bold',
    tableMode: 'bullets',
  });
  if (!ir.text.trim()) return [];
  return chunkMarkdownIR(ir, limit)
    .map((chunk) =>
      renderWithLinePrefixedBlockquotes(chunk, {
        styleMarkers: SLACK_STYLE_MARKERS,
        escapeText: escapeSlackMrkdwn,
        buildLink: buildSlackLink,
      }).trim(),
    )
    .filter((chunk) => chunk.length > 0);
}

// ---------------------------------------------------------------------------
// WeCom (`msgtype: 'markdown'`, 4096 UTF-8 byte ceiling)
// ---------------------------------------------------------------------------

const WECOM_STYLE_MARKERS: RenderStyleMap = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  code: { open: '`', close: '`' },
  code_block: { open: '```\n', close: '```' },
};

function renderWeComIR(ir: MarkdownIR): string {
  return renderWithLinePrefixedBlockquotes(ir, {
    styleMarkers: WECOM_STYLE_MARKERS,
    escapeText: (text) => text,
    buildLink: buildMarkdownLink,
  }).trim();
}

function splitChunkByUtf8Bytes(chunk: MarkdownIR, maxBytes: number): string[] {
  const rendered = renderWeComIR(chunk);
  if (!rendered) return [];
  if (Buffer.byteLength(rendered, 'utf8') <= maxBytes) {
    return [rendered];
  }
  if (chunk.text.length <= 1) {
    return [rendered];
  }
  const byteRatio = Buffer.byteLength(rendered, 'utf8') / chunk.text.length;
  const targetChars = Math.max(1, Math.floor((maxBytes * 0.85) / Math.max(byteRatio, 1)));
  const subChunks = chunkMarkdownIR(chunk, targetChars);
  if (subChunks.length <= 1) {
    // Single unbreakable token — fall back to plain UTF-8 safe slices.
    const out: string[] = [];
    let current = '';
    for (const ch of Array.from(rendered)) {
      if (Buffer.byteLength(current + ch, 'utf8') > maxBytes && current) {
        out.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    if (current) out.push(current);
    return out;
  }
  return subChunks.flatMap((sub) => splitChunkByUtf8Bytes(sub, maxBytes));
}

export function formatWeComOutboundChunks(markdown: string, maxBytes = 3800): string[] {
  if (!markdown?.trim()) return [];
  const ir = markdownToIR(markdown, {
    linkify: true,
    enableSpoilers: false,
    headingStyle: 'bold',
    tableMode: 'bullets',
  });
  if (!ir.text.trim()) return [];
  return splitChunkByUtf8Bytes(ir, maxBytes);
}

// ---------------------------------------------------------------------------
// Discord (native Markdown except GFM tables; 2000 char ceiling)
// ---------------------------------------------------------------------------

const DISCORD_STYLE_MARKERS: RenderStyleMap = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  strikethrough: { open: '~~', close: '~~' },
  spoiler: { open: '||', close: '||' },
  code: { open: '`', close: '`' },
  code_block: { open: '```\n', close: '```' },
};

export function formatDiscordOutboundText(markdown: string): string {
  if (!markdown?.trim()) return markdown;
  const { ir, hasTables } = markdownToIRWithMeta(markdown, {
    linkify: false,
    autolink: false,
    enableSpoilers: true,
    headingStyle: 'bold',
    tableMode: 'bullets',
  });
  if (!hasTables) {
    return markdown;
  }
  return renderWithLinePrefixedBlockquotes(ir, {
    styleMarkers: DISCORD_STYLE_MARKERS,
    escapeText: (text) => text,
    buildLink: buildMarkdownLink,
  }).trim();
}

export function formatDiscordOutboundChunks(markdown: string, limit = 1900): string[] {
  const formatted = formatDiscordOutboundText(markdown);
  return chunkText(formatted, limit);
}
