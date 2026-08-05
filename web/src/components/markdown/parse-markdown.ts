import { Marked, type MarkedOptions, type Tokens } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });

const markdownParser = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const safeLang = (lang ?? '').trim() || 'plaintext';
      const language = hljs.getLanguage(safeLang) ? safeLang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
  {
    extensions: [
      {
        name: 'punctuationBoundStrong',
        level: 'inline',
        start(src) {
          const index = src.indexOf('**');
          return index >= 0 ? index : undefined;
        },
        tokenizer(src) {
          return tokenizePunctuationBoundStrong(src, (text) =>
            this.lexer.inlineTokens(text),
          );
        },
      },
    ],
  },
);

const UNICODE_PUNCTUATION_RE = /^\p{P}$/u;

function isEscaped(text: string, index: number): boolean {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 1;
}

/**
 * AI responses commonly wrap quoted sentences or punctuation-ending CJK text
 * in strong markers without surrounding spaces. CommonMark rejects those
 * delimiter runs because punctuation touches a Unicode letter outside them.
 * Treat that shape as strong while preserving the standard tokenizer for all
 * other emphasis, including nested and triple-marker forms.
 */
function tokenizePunctuationBoundStrong(
  src: string,
  tokenizeInline: (text: string) => Tokens.Generic[],
): Tokens.Strong | undefined {
  if (!src.startsWith('**') || src.startsWith('***')) return undefined;

  let codeDelimiterLength = 0;
  for (let cursor = 2; cursor < src.length - 1;) {
    if (src[cursor] === '\\') {
      cursor += 2;
      continue;
    }

    if (src[cursor] === '`') {
      let runEnd = cursor + 1;
      while (src[runEnd] === '`') runEnd += 1;
      const runLength = runEnd - cursor;
      if (codeDelimiterLength === 0) codeDelimiterLength = runLength;
      else if (codeDelimiterLength === runLength) codeDelimiterLength = 0;
      cursor = runEnd;
      continue;
    }

    if (
      codeDelimiterLength === 0
      && src.startsWith('**', cursor)
      && src[cursor + 2] !== '*'
      && !isEscaped(src, cursor)
    ) {
      const text = src.slice(2, cursor);
      const first = Array.from(text)[0] ?? '';
      const last = Array.from(text).at(-1) ?? '';
      if (
        text.length > 0
        && !/^\s|\s$/u.test(text)
        && (UNICODE_PUNCTUATION_RE.test(first) || UNICODE_PUNCTUATION_RE.test(last))
      ) {
        return {
          type: 'strong',
          raw: src.slice(0, cursor + 2),
          text,
          tokens: tokenizeInline(text),
        };
      }
      return undefined;
    }

    cursor += 1;
  }
  return undefined;
}

const MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
  async: false as const,
} satisfies MarkedOptions;

/**
 * Parse markdown to HTML string.
 * Output MUST be passed through DOMPurify before dangerouslySetInnerHTML.
 */
export function parseMarkdown(
  text: string,
  overrides?: Partial<Omit<MarkedOptions, 'async'>>,
): string {
  return markdownParser.parse(text, { ...MARKED_OPTIONS, ...overrides, async: false });
}

export type StreamingMarkdownBlocks = {
  stable: string[];
  tail: string;
};

export type StreamingMarkdownRenderBlock = {
  /** Append-only source offset; remains stable when the tail becomes complete. */
  key: string;
  content: string;
  isTail: boolean;
};

const REFERENCE_DEFINITION_RE = /^(?: {0,3})\[[^\]]+\]:\s+\S+/m;

/**
 * Freeze completed top-level Markdown tokens while the final token is still
 * receiving SSE deltas. Reference-style links intentionally fall back to one
 * tail because their definitions can affect earlier tokens.
 */
export function splitStreamingMarkdownBlocks(text: string): StreamingMarkdownBlocks {
  if (!text || REFERENCE_DEFINITION_RE.test(text)) {
    return { stable: [], tail: text };
  }

  const tokens = markdownParser.lexer(text, MARKED_OPTIONS);
  let tailIndex = tokens.length - 1;
  while (tailIndex > 0 && tokens[tailIndex]?.type === 'space') {
    tailIndex -= 1;
  }
  if (tailIndex <= 0) {
    return { stable: [], tail: text };
  }

  const stable: string[] = [];
  for (const token of tokens.slice(0, tailIndex)) {
    const raw = token.raw ?? '';
    if (!raw) continue;
    if (token.type === 'space' && stable.length > 0) {
      stable[stable.length - 1] += raw;
    } else {
      stable.push(raw);
    }
  }
  const stableLength = stable.reduce((sum, block) => sum + block.length, 0);
  return {
    stable,
    tail: text.slice(stableLength),
  };
}

/**
 * Add stable React identities to streaming blocks. A block keeps the same key
 * when it moves from the mutable tail into the completed prefix, avoiding a
 * DOM replacement at every top-level Markdown boundary.
 */
export function buildStreamingMarkdownRenderBlocks(
  text: string,
): StreamingMarkdownRenderBlock[] {
  const { stable, tail } = splitStreamingMarkdownBlocks(text);
  let offset = 0;
  const blocks = stable.map((content) => {
    const block = {
      key: `markdown-${offset}`,
      content,
      isTail: false,
    };
    offset += content.length;
    return block;
  });
  blocks.push({
    key: `markdown-${offset}`,
    content: tail,
    isTail: true,
  });
  return blocks;
}
