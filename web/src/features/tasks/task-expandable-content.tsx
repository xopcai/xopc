import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { cn } from '@/lib/cn';

/** Keep the complete source; collapse only when the rendered content exceeds the preview. */
export function TaskExpandableContent({ content, contentKey, language, markdown = true, breaks = false, previewHeight = 240, className, children }: {
  content: string;
  contentKey: string;
  language: 'en' | 'zh';
  markdown?: boolean;
  breaks?: boolean;
  previewHeight?: number;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const expanded = searchParams.getAll('taskExpanded').includes(contentKey);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setOverflows(body.scrollHeight > previewHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [content, previewHeight]);

  const collapsed = overflows && !expanded;
  return <div className={cn('min-w-0', className)}>
    <div id={id} style={collapsed ? {
      maxHeight: previewHeight,
      overflow: 'hidden',
      maskImage: `linear-gradient(to bottom, black calc(100% - ${Math.min(24, previewHeight / 3)}px), transparent)`,
    } : undefined}>
      <div ref={bodyRef} inert={collapsed}>
        {children ?? (markdown ? <MarkdownView content={content} compact breaks={breaks} className="text-sm leading-6 text-fg" />
          : <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{content}</p>)}
      </div>
    </div>
    {overflows ? <button type="button" aria-expanded={expanded} aria-controls={id}
      className="mt-2 min-h-9 rounded-sm text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      onClick={() => setSearchParams((current) => {
        const next = new URLSearchParams(current);
        const keys = next.getAll('taskExpanded').filter((key) => key !== contentKey);
        next.delete('taskExpanded');
        for (const key of keys) next.append('taskExpanded', key);
        if (!expanded) next.append('taskExpanded', contentKey);
        return next;
      }, { preventScrollReset: true })}>
      {language === 'zh' ? (expanded ? '收起' : '查看更多') : (expanded ? 'Show less' : 'Show more')}
    </button> : null}
  </div>;
}
