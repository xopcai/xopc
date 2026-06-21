import { marked, type MarkedOptions } from 'marked';
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
