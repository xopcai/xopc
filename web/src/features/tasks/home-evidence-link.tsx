import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { modalizeTaskDetailHref } from './task-detail-route';

/** Evidence may point to a workspace route or an external source. */
export function HomeEvidenceLink({ href, children, onOpen }: { href?: string; children: ReactNode; onOpen?: () => void }) {
  const location = useLocation();
  const className = 'rounded-sm text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  if (href && /^https?:\/\//i.test(href)) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
  }
  if (href?.startsWith('/') && !href.startsWith('//')) {
    return <Link to={modalizeTaskDetailHref(`${location.pathname}${location.search}`, href)} className={className} onClick={onOpen}>{children}</Link>;
  }
  return <span>{children}</span>;
}
