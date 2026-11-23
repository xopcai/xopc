import { markdownItMath } from '@xopcai/markdown-math/markdownIt';
import 'katex/dist/katex.min.css';
import { type MouseEvent, useCallback, useMemo } from 'react';
import MarkdownIt from 'markdown-it';

import { t } from '../i18n';

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

markdownItMath(markdown);

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, index, options, environment, renderer);
};

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const rawInfo = token.info ? markdown.utils.unescapeAll(token.info).trim() : '';
  const lang = rawInfo.split(/\s+/)[0] ?? '';
  const escapedCode = markdown.utils.escapeHtml(token.content);
  const escapedLang = markdown.utils.escapeHtml(lang || 'code');
  const copyLabel = markdown.utils.escapeHtml(t('copy'));
  const copyAria = markdown.utils.escapeHtml(t('copyCode'));
  const langClass = lang ? ` class="language-${markdown.utils.escapeHtml(lang)}"` : '';
  return `<div class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${escapedLang}</span><button type="button" class="md-code-copy" data-copy-code="true" aria-label="${copyAria}">${copyLabel}</button></div><pre><code${langClass}>${escapedCode}</code></pre></div>`;
};

const defaultTableOpen = markdown.renderer.rules.table_open
  ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));
const defaultTableClose = markdown.renderer.rules.table_close
  ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));

markdown.renderer.rules.table_open = (tokens, index, options, environment, renderer) => (
  `<div class="md-table-wrap">${defaultTableOpen(tokens, index, options, environment, renderer)}`
);
markdown.renderer.rules.table_close = (tokens, index, options, environment, renderer) => (
  `${defaultTableClose(tokens, index, options, environment, renderer)}</div>`
);

export function renderSafeMarkdown(source: string, streaming = false): string {
  return markdown.render(source, { streaming });
}

export function MarkdownContent({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const html = useMemo(() => renderSafeMarkdown(children, streaming), [children, streaming]);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>('button[data-copy-code="true"]');
    if (!button) return;
    const code = button.closest('.md-code-block')?.querySelector('pre code')?.textContent ?? '';
    if (!code) return;
    void navigator.clipboard?.writeText(code).then(() => {
      button.dataset.copied = 'true';
      button.textContent = t('copied');
      window.setTimeout(() => {
        if (button.isConnected) {
          delete button.dataset.copied;
          button.textContent = t('copy');
        }
      }, 1_600);
    }).catch(() => undefined);
  }, []);

  return (
    <div className={`markdown-content${streaming ? ' is-streaming' : ''}`} onClick={handleClick}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming ? <span className="streaming-caret" aria-label={t('xopcResponding')} /> : null}
    </div>
  );
}
