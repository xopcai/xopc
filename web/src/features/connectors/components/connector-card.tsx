import { CheckCircle2, PackagePlus } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import type { ConnectorCategory, ConnectorDefinition, ConnectorInstance } from '../connectors-api';

const connectorSkeletonBar = 'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';

export const CONNECTOR_SKELETON_KEYS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] as const;

export function connectorIsInstalled(connector: ConnectorDefinition, instances: ConnectorInstance[]): boolean {
  return instances.some((instance) => instance.connectorId === connector.id);
}

function connectorCategoryLabel(category: ConnectorCategory, labels: ConnectorsSettingsMessages['connectorCategoryLabels']): string {
  return labels[category] ?? category;
}

function formatConnectorCategory(category: ConnectorCategory, t: ConnectorsSettingsMessages): string {
  return t.connectorCategoryTemplate.replace('{{category}}', connectorCategoryLabel(category, t.connectorCategoryLabels));
}

export function ConnectorCardSkeleton() {
  return (
    <div
      className="flex h-full min-h-[9.5rem] flex-col rounded-xl bg-surface-panel p-4 shadow-surface"
      aria-hidden
    >
      <div className="flex min-h-0 flex-1 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className={cn('h-4 min-w-0 flex-1', connectorSkeletonBar)} />
            <div className={cn('h-8 w-[4.5rem] shrink-0 rounded-lg', connectorSkeletonBar)} />
          </div>
          <div className={cn('h-3 w-full', connectorSkeletonBar)} />
          <div className={cn('h-3 w-[88%]', connectorSkeletonBar)} />
        </div>
      </div>
    </div>
  );
}

export function InstalledConnectorRowSkeleton() {
  return (
    <div className="rounded-2xl bg-surface-panel p-4 shadow-surface" aria-hidden>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className={cn('h-4 w-48 max-w-full', connectorSkeletonBar)} />
          <div className={cn('h-3 w-72 max-w-full', connectorSkeletonBar)} />
        </div>
        <div className="flex shrink-0 gap-2">
          <div className={cn('h-9 w-20 rounded-lg', connectorSkeletonBar)} />
          <div className={cn('h-9 w-20 rounded-lg', connectorSkeletonBar)} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <div className={cn('h-8 w-20 rounded-md', connectorSkeletonBar)} />
        <div className={cn('h-8 w-24 rounded-md', connectorSkeletonBar)} />
        <div className={cn('h-8 w-28 rounded-md', connectorSkeletonBar)} />
      </div>
      <div className={cn('mt-3 h-20 rounded-xl', connectorSkeletonBar)} />
    </div>
  );
}

export function ConnectorCard({
  connector,
  installed,
  onInstall,
  onOpenDetails,
  t,
}: {
  connector: ConnectorDefinition;
  installed: boolean;
  onInstall: (connector: ConnectorDefinition) => void;
  onOpenDetails?: (connector: ConnectorDefinition) => void;
  t: ConnectorsSettingsMessages;
}) {
  const categoryLabel = formatConnectorCategory(connector.category, t);
  const visibleCapabilities = connector.capabilities.slice(0, 4);
  const hiddenCapabilityCount = Math.max(0, connector.capabilities.length - visibleCapabilities.length);
  const renderInstallButton = (className?: string) => (
    <Button
      type="button"
      variant="primary"
      className={cn('h-8 justify-center px-2.5 text-xs font-medium', className)}
      onClick={(event) => {
        event.stopPropagation();
        onInstall(connector);
      }}
    >
      <PackagePlus className="size-4" />
      {t.install}
    </Button>
  );
  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onOpenDetails || event.currentTarget !== event.target) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpenDetails(connector);
  };

  return (
    <div
      className={cn(
        'group flex min-h-[9.5rem] flex-col rounded-lg bg-surface-panel p-4 shadow-surface transition-colors hover:bg-surface-hover/45 focus-within:ring-2 focus-within:ring-accent/30',
        onOpenDetails ? 'cursor-pointer' : null,
      )}
      role={onOpenDetails ? 'button' : undefined}
      tabIndex={onOpenDetails ? 0 : undefined}
      onClick={() => onOpenDetails?.(connector)}
      onKeyDown={handleCardKeyDown}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-fg">{connector.displayName}</h3>
              <p className="mt-1 truncate text-xs text-fg-subtle">{categoryLabel}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {!installed ? (
              <div className="hidden shrink-0 items-center gap-1 transition-opacity sm:pointer-events-none sm:flex sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100">
                {renderInstallButton()}
              </div>
            ) : null}
            {installed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3" aria-hidden />
                {t.installedBadge}
              </span>
            ) : null}
          </div>
        </div>

        <p className="mt-4 line-clamp-2 text-sm leading-6 text-fg-muted" title={connector.description}>
          {connector.description}
        </p>

        {visibleCapabilities.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {visibleCapabilities.map((capability) => (
              <span
                key={capability}
                className="rounded-md bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted"
              >
                {capability}
              </span>
            ))}
            {hiddenCapabilityCount > 0 ? (
              <span className="rounded-md bg-surface-base px-2 py-0.5 text-[11px] text-fg-subtle">
                +{hiddenCapabilityCount}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {!installed ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-edge pt-3 sm:hidden">
          {renderInstallButton('w-full')}
        </div>
      ) : null}
    </div>
  );
}
