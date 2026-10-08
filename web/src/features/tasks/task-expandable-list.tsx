import { Children, useId, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export function TaskExpandableList({ children, contentKey, language, className }: {
  children: ReactNode;
  contentKey: string;
  language: 'zh' | 'en';
  className?: string;
}) {
  const id = useId();
  const items = Children.toArray(children);
  const [params, setParams] = useSearchParams();
  const expanded = params.getAll('taskExpanded').includes(contentKey);
  return <div className={className}>
    <ul id={id} className="space-y-1.5">{expanded ? items : items.slice(0, 3)}</ul>
    {items.length > 3 ? <button type="button" aria-expanded={expanded} aria-controls={id}
      className="mt-2 min-h-9 rounded-sm text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      onClick={() => setParams((current) => {
        const next = new URLSearchParams(current);
        const keys = next.getAll('taskExpanded').filter(key => key !== contentKey);
        next.delete('taskExpanded');
        keys.forEach(key => next.append('taskExpanded', key));
        if (!expanded) next.append('taskExpanded', contentKey);
        return next;
      }, { preventScrollReset: true })}>
      {language === 'zh' ? (expanded ? '收起' : `查看全部（${items.length}）`) : (expanded ? 'Show less' : `Show all (${items.length})`)}
    </button> : null}
  </div>;
}
