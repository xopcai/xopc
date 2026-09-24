import { Boxes, BriefcaseBusiness, Layers3, Zap } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { preloadRouteForPath } from '@/lib/route-preload';
import {
  PRODUCT_DOMAINS,
  productDomainAtPath,
  type ProductDomainId,
} from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';

const DOMAIN_ICONS = {
  work: BriefcaseBusiness,
  automation: Zap,
  capabilities: Layers3,
  apps: Boxes,
} as const satisfies Record<ProductDomainId, typeof BriefcaseBusiness>;

export function SidebarNavItems({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).productNavigation;
  const activeDomain = productDomainAtPath(pathname);

  return PRODUCT_DOMAINS.map((domain) => {
    const Icon = DOMAIN_ICONS[domain.id];
    const label = copy.domains[domain.id];
    const active = activeDomain === domain.id;
    return (
      <Link
        key={domain.id}
        to={domain.path}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          collapsed ? 'justify-center rounded-xl p-2.5' : 'gap-2 rounded-lg px-3 py-2 text-left',
          active ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        )}
        title={label}
        onMouseEnter={() => preloadRouteForPath(domain.path)}
        onFocus={() => preloadRouteForPath(domain.path)}
        onClick={onNavigate}
      >
        <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </Link>
    );
  });
}
