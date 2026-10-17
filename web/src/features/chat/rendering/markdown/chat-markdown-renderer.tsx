import { remarkXopcMath, mathRanges } from '@xopcai/markdown-math/remark';
import { rehypeXopcMath } from '@xopcai/markdown-math/rehype';
import { cjk } from '@streamdown/cjk';
import type { Element } from 'hast';
import { createContext, createElement, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ComponentPropsWithoutRef, type JSX } from 'react';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Block, Streamdown, defaultRemarkPlugins, defaultUrlTransform, useIsCodeFenceIncomplete, type BlockProps, type Components } from 'streamdown';

import type { MarkdownViewProps } from '@/components/markdown/markdown-view';
import { parseWorkspaceFileLinkTarget, type WorkspaceFileLinkTarget } from '@/components/markdown/internal-links';
import { recordStreamingParse, recordStreamingShape } from '@/components/markdown/streaming-render-metrics';
import { messages } from '@/i18n/messages';
import { resolveAppLink } from '@/lib/app-link';
import { useAppLinkOpener } from '@/lib/use-app-link-opener';
import { useLocaleStore } from '@/stores/locale-store';
import '@/components/markdown/markdown.css';
import 'katex/dist/katex.min.css';

import { PartErrorBoundary } from '../part-error-boundary';
import { createChatBlockParser, parseChatMarkdownBlocks } from './chat-math-blocks';
import { MathElement } from '@/components/markdown/math-element';
import { ChatCodeBlock } from './chat-code-block';
import { ChatChartBlock } from './chat-chart-block';
import { isChartFenceClosed } from './chart-fence';
import { rehypeChatFileMentions, rehypeChatFragments, rehypeChatLinks, remarkChatContent } from './chat-markdown-plugins';
import { createRevealPlugin, REVEAL_DURATION_MS, RevealBudgetContext, RevealLedgerContext, RevealSpan, type RevealLedger } from './chat-text-reveal';

type Environment = {
  openLink: (href: string) => void; linkError: string | null;
  streaming: boolean; initialBlocks: number; mathRemaining: number[]; metricsKey?: string;
  copy: boolean; renderMermaid: boolean; mermaidActions: boolean;
  openFile?: (target: WorkspaceFileLinkTarget) => void;
  loadImage?: (target: WorkspaceFileLinkTarget) => Promise<Blob>;
};
const EnvironmentContext = createContext<Environment | null>(null);
const BlockSourceContext = createContext('');

function ChatLink({ node, href = '', children, className, ...props }: ComponentProps<'a'> & { node?: Element }) {
  const environment = useContext(EnvironmentContext)!;
  const language = useLocaleStore(s => s.language);
  const labels = messages(language).chat.contentLinks;
  const fragment = href.startsWith('#') && !href.startsWith('#/');
  const intent = resolveAppLink(href);
  const target = !href.startsWith('#') && intent.kind !== 'internal-route' && environment.openFile ? parseWorkspaceFileLinkTarget(href) : null;
  if (!fragment && !target && intent.kind === 'blocked') return <>{children}</>;
  const internal = intent.kind === 'internal-route';
  const destination = internal ? intent.route.slice(1).split(/[/?#]/, 1)[0] : '';
  const label = (labels.destinations as Record<string, string>)[destination] ?? labels.open;
  const text = node ? textIn(node).trim() : typeof children === 'string' ? children.trim() : '';
  const visibleLabel = internal && /^(?:xopc:\/\/|#\/|Open(?: in xopc)?$|打开$)/i.test(text) ? label : children;
  const effectiveHref = internal ? `#${intent.route}` : href;
  return <a {...props} href={effectiveHref} target={internal || target || fragment ? undefined : '_blank'} rel="noopener noreferrer"
    className={[className, target ? 'markdown-file-link' : ''].filter(Boolean).join(' ') || undefined}
    data-xopc-link-kind={fragment ? 'document-fragment' : target ? undefined : intent.kind}
    data-xopc-file-path={target?.path} data-xopc-file-kind={target?.kind} data-xopc-line={target?.line}
    title={environment.linkError === effectiveHref ? labels.failed : props.title || (internal ? label : undefined)}
    onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (fragment) {
        const root = event.currentTarget.closest('.markdown-render-boundary');
        const id = href.slice(1);
        let decodedId = id;
        try { decodedId = decodeURIComponent(id); } catch { /* Literal IDs can contain percent signs. */ }
        const elements = Array.from(root?.querySelectorAll<HTMLElement>('[id]') ?? []);
        const destination = elements.find(element => element.id === id) ?? elements.find(element => element.id === decodedId);
        if (!destination) return;
        destination.closest('[data-chat-scroll-viewport]')?.dispatchEvent(new Event('chat-scroll-reading'));
        destination.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        if (!destination.hasAttribute('tabindex')) destination.setAttribute('tabindex', '-1');
        destination.focus({ preventScroll: true });
        return;
      }
      if (target) { environment.openFile?.(target); return; }
      environment.openLink(effectiveHref);
    }}>{visibleLabel}</a>;
}

function ChatImage({ node: _node, src = '', alt, ...props }: ComponentProps<'img'> & { node?: Element }) {
  const environment = useContext(EnvironmentContext)!;
  const [loaded, setLoaded] = useState<{ source: string; url: string } | null>(null);
  const target = parseWorkspaceFileLinkTarget(src);
  const path = target?.path;
  const line = target?.line;
  const kind = target?.kind;
  useEffect(() => {
    if (!path || !kind || !environment.loadImage) return;
    let current = true;
    let url: string | undefined;
    void environment.loadImage({ path, line, kind }).then(blob => {
      if (!current) return;
      url = URL.createObjectURL(blob);
      setLoaded({ source: src, url });
    }).catch(() => {});
    return () => { current = false; if (url) URL.revokeObjectURL(url); };
  }, [environment.loadImage, path, line, kind, src]);
  const finalSrc = target ? loaded?.source === src ? loaded.url : undefined : src;
  return <img {...props} src={finalSrc} alt={alt} loading="lazy" decoding="async" />;
}

function textIn(node: Element): string {
  return node.children.map(child => child.type === 'text' ? child.value : child.type === 'element' ? textIn(child) : '').join('');
}

function ChatPre({ node }: ComponentProps<'pre'> & { node?: Element }) {
  const environment = useContext(EnvironmentContext)!;
  const blockSource = useContext(BlockSourceContext);
  const incomplete = useIsCodeFenceIncomplete();
  const child = node?.children.find((n): n is Element => n.type === 'element' && n.tagName === 'code');
  const language = String(child?.properties.className ?? '').match(/language-([^,\s]+)/)?.[1] ?? '';
  const code = child ? textIn(child).replace(/\n$/, '') : '';
  if (language === 'chart') return <ChatChartBlock source={code}
    incomplete={incomplete || !isChartFenceClosed(blockSource, node?.position?.start.line, node?.position?.end.line)}
    streaming={environment.streaming} copy={environment.copy} />;
  return <ChatCodeBlock code={code} language={language}
    incomplete={incomplete} renderMermaid={environment.renderMermaid} actions={environment.mermaidActions} copy={environment.copy} />;
}

function ChatTable({ node, children, style, ...props }: ComponentProps<'table'> & { node?: Element }) {
  const section = node?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'thead');
  const row = (section ?? node)?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'tr');
  const columns = row?.children.filter(child => child.type === 'element' && ['th', 'td'].includes(child.tagName)).length ?? 1;
  return <div className="markdown-table-scroll" tabIndex={0}>
    <table {...props} style={{ ...style, minWidth: `${columns * 6}rem` }}>{children}</table>
  </div>;
}

function MathSpan(props: ComponentProps<'span'> & { node?: Element }) {
  return (props.node?.properties.dataXopcMath ?? props.node?.properties['data-xopc-math']) ? <MathElement {...props} /> : <RevealSpan {...props} />;
}
function MathDiv(props: ComponentProps<'div'> & { node?: Element }) {
  return (props.node?.properties.dataXopcMath ?? props.node?.properties['data-xopc-math']) ? <MathElement {...props} display /> : <div {...Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'node'))} />;
}

const passthrough = <T extends keyof JSX.IntrinsicElements>(tag: T) => {
  return function MarkdownElement({ node: _node, ...props }: ComponentPropsWithoutRef<T> & { node?: Element }) {
    const alignment = (tag === 'th' || tag === 'td') && typeof _node?.properties.align === 'string'
      ? _node.properties.align : undefined;
    return createElement(tag, { ...props, 'data-markdown-align': alignment });
  };
};
const components: Components = {
  a: ChatLink, img: ChatImage, pre: ChatPre, span: MathSpan, div: MathDiv,
  p: passthrough('p'), h1: passthrough('h1'), h2: passthrough('h2'), h3: passthrough('h3'), h4: passthrough('h4'),
  h5: passthrough('h5'), h6: passthrough('h6'), ul: passthrough('ul'), ol: passthrough('ol'), li: passthrough('li'),
  strong: passthrough('strong'), em: passthrough('em'), blockquote: passthrough('blockquote'),
  code: passthrough('code'), table: ChatTable, thead: passthrough('thead'), tbody: passthrough('tbody'),
  tr: passthrough('tr'), th: passthrough('th'), td: passthrough('td'), hr: passthrough('hr'),
};
const schema = { ...defaultSchema, attributes: { ...defaultSchema.attributes,
  code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/, 'math-inline', 'math-display'], 'data-xopc-math-source'],
} };
const baseRehype = [rehypeChatLinks, [rehypeSanitize, schema]] as NonNullable<BlockProps['rehypePlugins']>;

const wholeDocument = (markdown: string) => /^\s{0,3}\[[^\]]+\]:|\[[^\]]+\]\[[^\]]*\]|\[\^/m.test(markdown);


const ChatBlock = memo(function ChatBlock(props: BlockProps) {
  const blockId = useId();
  const environment = useContext(EnvironmentContext)!;
  const host = useRef<HTMLDivElement>(null);
  const budget = useContext(RevealBudgetContext)!;
  const [ledger] = useState<RevealLedger>(() => ({ length: 0, starts: new Map() }));
  const previous = useRef('');
  const mounted = useRef(false);
  const [settledRevision, refresh] = useState(0);
  const initial = !mounted.current && props.index < environment.initialBlocks;
  // Remend adds closing delimiters to an unfinished block; those closers are not source edits.
  const previousPrefix = previous.current.trimEnd().replace(/[*_~`]+$/, '');
  const replacing = mounted.current && !props.content.startsWith(previousPrefix);
  // Let in-flight fades finish when the transport marks the response complete.
  const animate = (environment.streaming || ledger.starts.size > 0) && !wholeDocument(props.content) && !replacing;
  const revealPlugin = useMemo(() => createRevealPlugin(ledger, animate, initial, budget, blockId), [ledger, animate, initial, settledRevision, budget, blockId]);
  const remaining = environment.mathRemaining[props.index] ?? 256;
  const rehypePlugins = useMemo(() => [...(props.rehypePlugins ?? []).map(plugin => Array.isArray(plugin) && plugin[0] === rehypeXopcMath
    ? [rehypeXopcMath, { streaming: environment.streaming, maxCount: remaining }] : plugin), revealPlugin] as NonNullable<BlockProps['rehypePlugins']>,
  [props.rehypePlugins, revealPlugin, environment.streaming, remaining]);
  const startedAt = performance.now();

  useLayoutEffect(() => {
    if (environment.metricsKey) recordStreamingParse(environment.metricsKey, performance.now() - startedAt);
    ledger.length = Number(host.current?.querySelector('[data-xopc-watermark]')?.getAttribute('data-xopc-watermark') ?? 0);
    if (replacing) ledger.starts.clear();
    previous.current = props.content;
    mounted.current = true;
    for (const [id, at] of ledger.starts) if (performance.now() - at >= REVEAL_DURATION_MS) ledger.starts.delete(id);
  }, [props.content, environment.metricsKey, ledger, replacing]);

  useEffect(() => {
    const settle = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && host.current?.contains(selection.anchorNode)) return;
      if (host.current?.querySelector('[data-xopc-segment]')) { ledger.starts.clear(); refresh(n => n + 1); }
    };
    const timer = window.setTimeout(settle, REVEAL_DURATION_MS + 50);
    document.addEventListener('selectionchange', settle);
    return () => { window.clearTimeout(timer); document.removeEventListener('selectionchange', settle); };
  }, [props.content, ledger]);

  return <div ref={host} className="markdown-stream-block">
    <PartErrorBoundary content={props.content}>
      <BlockSourceContext.Provider value={props.content}><RevealLedgerContext.Provider value={ledger}><Block {...props} shouldParseIncompleteMarkdown={props.shouldParseIncompleteMarkdown && mathRanges(props.content).length === 0} rehypePlugins={rehypePlugins} /></RevealLedgerContext.Provider></BlockSourceContext.Provider>
    </PartErrorBoundary>
  </div>;
});

export const ChatMarkdownRenderer = memo(function ChatMarkdownRenderer({
  content, compact = false, breaks = false, className, codeCopy = true,
  onWorkspaceFileOpen, onWorkspaceImageLoad, renderMermaid = true, mermaidActions = false,
  streamingMetricsKey, streaming = false,
}: MarkdownViewProps & { streaming?: boolean }) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const openAppLink = useAppLinkOpener();
  const locale = useLocaleStore(s => s.language);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkGeneration = useRef(0);
  const activeLink = useRef<string | null>(null);
  const openLink = useCallback((href: string) => {
    const generation = ++linkGeneration.current;
    activeLink.current = href;
    setLinkError(null);
    void openAppLink(href).then(result => {
      if (generation === linkGeneration.current) {
        if (result.ok) activeLink.current = null;
        setLinkError(result.ok ? null : href);
      }
    }).catch(() => { if (generation === linkGeneration.current) setLinkError(href); });
  }, [openAppLink]);
  useEffect(() => () => { linkGeneration.current++; }, []);
  useEffect(() => {
    const href = activeLink.current;
    if (!href || Array.from(host.current?.querySelectorAll('a[href]') ?? []).some(anchor => anchor.getAttribute('href') === href)) return;
    activeLink.current = null;
    linkGeneration.current++;
    setLinkError(null);
  }, [content]);
  const [budget] = useState(() => new Set<Animation>());
  const [mode] = useState<'streaming' | 'static'>(() => streaming || !content ? 'streaming' : 'static');
  const [chatBlocks] = useState(createChatBlockParser);
  const [initialBlocks] = useState(() => mode === 'streaming' ? parseChatMarkdownBlocks(content).length : 0);
  const plugins = useMemo(() => ({ cjk, math: { name: 'katex' as const, type: 'math' as const, remarkPlugin: remarkXopcMath, rehypePlugin: [rehypeXopcMath, { streaming }] as NonNullable<BlockProps['rehypePlugins']>[number] } }), [streaming]);
  const mathRemaining = useMemo(() => {
    let used = 0;
    return chatBlocks(content).map(block => { const remaining = Math.max(0, 256 - used); used += mathRanges(block).length; return remaining; });
  }, [content, chatBlocks]);
  const environment = useMemo<Environment>(() => ({ openLink, linkError, streaming, initialBlocks, mathRemaining, metricsKey: streamingMetricsKey,
    copy: codeCopy, renderMermaid, mermaidActions, openFile: onWorkspaceFileOpen, loadImage: onWorkspaceImageLoad,
  }), [openLink, linkError, streaming, initialBlocks, mathRemaining, streamingMetricsKey, codeCopy, renderMermaid, mermaidActions, onWorkspaceFileOpen, onWorkspaceImageLoad]);
  const remarkPlugins = useMemo(() => [...Object.values(defaultRemarkPlugins), [remarkChatContent, { breaks }]] as NonNullable<BlockProps['remarkPlugins']>, [breaks]);
  const rehypePlugins = useMemo(() => [...baseRehype,
    ...(onWorkspaceFileOpen ? [rehypeChatFileMentions] : []),
    [rehypeChatFragments, { prefix: `xopc-markdown-${id}` }],
  ] as NonNullable<BlockProps['rehypePlugins']>, [id, onWorkspaceFileOpen]);
  useLayoutEffect(() => {
    if (!import.meta.env.DEV || !streamingMetricsKey) return;
    const blocks = host.current?.querySelectorAll('.markdown-stream-block');
    recordStreamingShape(streamingMetricsKey, Math.max(0, (blocks?.length ?? 0) - 1), blocks?.item((blocks.length ?? 1) - 1)?.textContent?.length ?? 0);
  }, [content, streamingMetricsKey]);
  return <EnvironmentContext.Provider value={environment}><BlockSourceContext.Provider value={content}><RevealBudgetContext.Provider value={budget}>
    <div ref={host} className="markdown-render-boundary" data-chat-markdown={id}>
      <PartErrorBoundary content={content}>
        <Streamdown className={['markdown-body xopc-chat-markdown', compact ? 'markdown-compact' : '',
          breaks ? 'markdown-breaks' : '', onWorkspaceFileOpen ? 'markdown-workspace-links' : '', className].filter(Boolean).join(' ')}
          mode={mode} isAnimating={streaming} animated={false} parseIncompleteMarkdown={streaming}
          components={components} plugins={plugins} controls={false} BlockComponent={ChatBlock}
          parseMarkdownIntoBlocksFn={chatBlocks} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
          urlTransform={defaultUrlTransform}>
          {content}
        </Streamdown>
      </PartErrorBoundary>
      {linkError ? <p role="alert" className="mt-2 text-sm text-danger">{messages(locale).chat.contentLinks.failed}</p> : null}
    </div>
  </RevealBudgetContext.Provider></BlockSourceContext.Provider></EnvironmentContext.Provider>;
});
