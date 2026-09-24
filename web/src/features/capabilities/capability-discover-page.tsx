import { AlertCircle, Cable, Layers, Package, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  connectorCapabilityItems,
  extensionCapabilityItems,
  filterCapabilityCatalog,
  skillCapabilityItems,
  type CapabilityCatalogItem,
  type CapabilityKind,
} from '@/features/capabilities/capability-catalog';
import {
  fetchConnectorCatalog,
  fetchConnectorInstances,
  fetchStoreConnectorCatalog,
} from '@/features/connectors/connectors-api';
import { ConnectorLogo } from '@/features/connectors/components/connector-logo';
import { getExtensionMarketplaceItems } from '@/features/extensions/extension-marketplace-api';
import { useExtensions } from '@/features/extensions/extension-provider';
import { getMarketplaceSkills, getSkills } from '@/features/skills/skill-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type CatalogResult = { items: CapabilityCatalogItem[]; failedSources: number };
type Filter = CapabilityKind | 'all';

async function loadCapabilityCatalog(query: string, installedExtensionIds: Set<string>): Promise<CatalogResult> {
  const [skills, installedSkills, connectors, storeConnectors, instances, extensions] = await Promise.allSettled([
    getMarketplaceSkills({ q: query, page: 1, pageSize: 18, sort: 'downloads' }),
    getSkills(),
    fetchConnectorCatalog(),
    fetchStoreConnectorCatalog({ q: query, page: 1, pageSize: 18, sort: 'downloads' }),
    fetchConnectorInstances(),
    getExtensionMarketplaceItems(query),
  ]);

  const items: CapabilityCatalogItem[] = [];
  if (skills.status === 'fulfilled') {
    items.push(...skillCapabilityItems(skills.value.items, installedSkills.status === 'fulfilled' ? installedSkills.value.catalog : []));
  }
  if (connectors.status === 'fulfilled' || storeConnectors.status === 'fulfilled') {
    items.push(...connectorCapabilityItems(
      connectors.status === 'fulfilled' ? connectors.value : [],
      storeConnectors.status === 'fulfilled' ? storeConnectors.value.items : [],
      instances.status === 'fulfilled' ? instances.value : [],
    ));
  }
  if (extensions.status === 'fulfilled') {
    items.push(...extensionCapabilityItems(extensions.value, installedExtensionIds));
  }

  const failedSources = [skills, connectors, storeConnectors, extensions].filter(result => result.status === 'rejected').length;
  if (failedSources === 4) throw new Error('Capability catalog unavailable');
  return { items, failedSources };
}

const KIND_ICON = { skill: Layers, connector: Cable, extension: Package } as const;

export function CapabilityDiscoverPage({ onHeaderEndChange }: { onHeaderEndChange?: (node: ReactNode | null) => void }) {
  const language = useLocaleStore(state => state.language);
  const copy = messages(language).capabilitiesHub;
  const hasToken = useGatewayStore(state => Boolean(state.conversationId));
  const installedExtensions = useExtensions();
  const installedExtensionIds = useMemo(
    () => new Set(installedExtensions.flatMap(extension => [extension.id, extension.pluginId].filter((id): id is string => Boolean(id)))),
    [installedExtensions],
  );
  const installedExtensionKey = [...installedExtensionIds].sort().join('|');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { data, error, isLoading } = useSWR(
    hasToken ? ['capability-catalog', debouncedQuery, installedExtensionKey] : null,
    () => loadCapabilityCatalog(debouncedQuery, installedExtensionIds),
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  const visibleItems = useMemo(
    () => filterCapabilityCatalog(data?.items ?? [], filter, query),
    [data?.items, filter, query],
  );
  const filters = useMemo<Array<{ id: Filter; label: string }>>(() => [
    { id: 'all', label: copy.filterAll },
    { id: 'skill', label: copy.tabSkills },
    { id: 'connector', label: copy.tabConnectors },
    { id: 'extension', label: copy.tabExtensions },
  ], [copy.filterAll, copy.tabConnectors, copy.tabExtensions, copy.tabSkills]);
  const headerEnd = useMemo(() => (
    <div className="flex items-center gap-2">
      <div className="relative w-44 sm:w-56">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchLabel}
          className="ui-input h-9 w-full rounded-xl border border-edge bg-surface-base pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted"
        />
      </div>
      <div className="hidden items-center gap-1 lg:flex" aria-label={copy.filterAria}>
        {filters.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-sm transition-colors',
              filter === option.id ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
            aria-pressed={filter === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>
      <PopoverSelect
        value={filter}
        options={filters.map(option => ({ value: option.id, label: option.label }))}
        placeholder={copy.filterAll}
        allowEmpty={false}
        ariaLabel={copy.filterAria}
        triggerClassName="h-9 w-auto lg:hidden"
        align="end"
        onChange={value => setFilter(value as Filter)}
      />
    </div>
  ), [copy.filterAria, copy.searchLabel, copy.searchPlaceholder, filter, filters, query]);

  useLayoutEffect(() => {
    onHeaderEndChange?.(headerEnd);
    return () => onHeaderEndChange?.(null);
  }, [headerEnd, onHeaderEndChange]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        {data?.failedSources ? (
          <div className="flex items-center gap-2 rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg-muted" role="status">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {copy.partialResults}
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger" role="alert">{copy.loadFailed}</p> : null}

        {isLoading && !data ? <CapabilityGridSkeleton /> : null}
        {!isLoading && data && visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge px-6 py-16 text-center">
            <p className="font-medium text-fg">{copy.emptyTitle}</p>
            <p className="mt-1 text-sm text-fg-muted">{copy.emptyBody}</p>
          </div>
        ) : null}
        {visibleItems.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map(item => <CapabilityCard key={`${item.kind}:${item.id}`} item={item} copy={copy} />)}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function CapabilityCard({ item, copy }: { item: CapabilityCatalogItem; copy: ReturnType<typeof messages>['capabilitiesHub'] }) {
  const Icon = KIND_ICON[item.kind];
  const statusLabel = item.status === 'attention'
    ? copy.statusAttention
    : item.status === 'installed'
      ? copy.statusInstalled
      : copy.statusAvailable;
  const kindLabel = item.kind === 'skill' ? copy.kindSkill : item.kind === 'connector' ? copy.kindConnector : copy.kindExtension;
  return (
    <li className="flex min-h-52 flex-col rounded-2xl border border-edge bg-surface-panel p-5 shadow-surface">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {item.kind === 'connector' ? (
            <ConnectorLogo connector={{ displayName: item.name, branding: item.iconUrl ? { logoUrl: item.iconUrl } : undefined }} />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-fg-muted">
              <Icon className="size-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-fg">{item.name}</h2>
            <p className="truncate text-xs text-fg-muted">{item.source}</p>
          </div>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-1 text-xs',
          item.status === 'attention' ? 'bg-danger/10 text-danger' : 'bg-surface-hover text-fg-muted',
        )}>{statusLabel}</span>
      </div>
      <p className="mt-4 line-clamp-3 flex-1 text-sm leading-6 text-fg-muted">{item.description || copy.noDescription}</p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-edge-subtle pt-4">
        <span className="text-xs uppercase tracking-wide text-fg-muted">{kindLabel}</span>
        <Button asChild variant={item.status === 'available' ? 'primary' : 'secondary'} className="h-8 px-3 py-1.5">
          <Link to={item.href}>{item.status === 'available' ? copy.viewAction : copy.manageAction}</Link>
        </Button>
      </div>
    </li>
  );
}

function CapabilityGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
      {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-52 rounded-2xl" />)}
    </div>
  );
}
