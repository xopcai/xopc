import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, index, options, environment, renderer);
};

export function renderSafeMarkdown(source: string): string {
  return markdown.render(source);
}

export function MarkdownContent({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const html = useMemo(() => renderSafeMarkdown(children), [children]);
  return (
    <div className={`markdown-content${streaming ? ' is-streaming' : ''}`}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming ? <span className="streaming-caret" aria-label="xopc is responding" /> : null}
    </div>
  );
}
