import { Boxes, BriefcaseBusiness, Layers3, Zap } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { PRODUCT_DOMAINS, productDomainAtPath, type ProductDomainId } from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';

const DOMAIN_ICONS = {
  work: BriefcaseBusiness,
  automation: Zap,
  capabilities: Layers3,
  apps: Boxes,
} as const satisfies Record<ProductDomainId, typeof BriefcaseBusiness>;

export function MobilePrimaryNav() {
  const { pathname } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).productNavigation;
  const activeDomain = productDomainAtPath(pathname);
  return (
    <nav aria-label={copy.primaryAria} className="flex shrink-0 border-t border-edge-subtle bg-surface-panel pb-[env(safe-area-inset-bottom)] md:hidden">
      {PRODUCT_DOMAINS.map((domain) => {
        const Icon = DOMAIN_ICONS[domain.id];
        const active = domain.id === activeDomain;
        return (
          <Link
            key={domain.id}
            to={domain.path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
              active ? 'text-accent-fg' : 'text-fg-muted',
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
            <span className="max-w-full truncate">{copy.domains[domain.id]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
