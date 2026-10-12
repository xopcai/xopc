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

import { appLinksExtension } from './app-links';

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
  appLinksExtension,
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
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
    },
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
