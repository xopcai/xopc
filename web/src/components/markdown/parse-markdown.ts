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

const MARKED_OPTIONS: MarkedOptions = {
  gfm: true,
  breaks: false,
};

/**
 * Parse markdown to HTML string.
 * Output MUST be passed through DOMPurify before dangerouslySetInnerHTML.
 */
export function parseMarkdown(text: string): string {
  return marked.parse(text, MARKED_OPTIONS) as string;
}
