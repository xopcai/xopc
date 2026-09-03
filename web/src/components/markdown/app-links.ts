import type { MarkedExtension, Tokens } from 'marked';

import { resolveAppLink } from '@/lib/app-link';

function unescapeLink(value: string): string {
  return value.replace(/\\([\\_()[\]*])/g, '$1')
    .replace(/&(?:amp|#0*38|#x0*26);/gi, '&');
}

/** Resolve links as Markdown tokens so code samples and images stay verbatim. */
export const appLinksExtension: MarkedExtension = {
  walkTokens(token) {
    if (token.type !== 'link') return;
    const href = unescapeLink(token.href);
    if (!/^xopc:\/\//i.test(href)) return;
    const intent = resolveAppLink(href, 'https://xopc.local/');
    if (intent.kind === 'internal-route') token.href = `#${intent.route}`;
  },
  extensions: [{
    name: 'xopcLink',
    level: 'inline',
    start(src) {
      const index = src.search(/xopc:\/\/|\[[^\]\n]+\]\\\(xopc:\/\//i);
      return index < 0 ? undefined : index;
    },
    tokenizer(src) {
      if (this.lexer.state.inLink) return undefined;
      // Recover only escaped xopc link delimiters, not arbitrary escaped Markdown.
      const escaped = /^\[([^\]\n]+)\]\\\((xopc:\/\/[^\s<>]+?)\\\)/i.exec(src);
      const bare = /^(?:xopc:\/\/)[^\s<>\[\]()"'，。；！？、]+/i.exec(src);
      const raw = escaped?.[0] ?? bare?.[0]?.replace(/[.,;!?]+$/, '');
      if (!raw) return undefined;
      const href = unescapeLink(escaped?.[2] ?? raw);
      const text = unescapeLink(escaped?.[1] ?? raw);
      return {
        type: 'link', raw, href, text, title: null,
        tokens: [{
          type: 'text', raw: text,
          text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        }],
      } satisfies Tokens.Link;
    },
  }],
};
