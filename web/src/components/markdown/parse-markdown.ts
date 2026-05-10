import { marked, type MarkedOptions } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

marked.use(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const safeLang = (lang ?? '').trim() || 'plaintext';
      const language = hljs.getLanguage(safeLang) ? safeLang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);

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
  return marked.parse(text, { ...MARKED_OPTIONS, ...overrides, async: false });
}
