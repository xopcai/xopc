import { Cable, CheckCircle2, PackagePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import type { ConnectorDefinition, ConnectorInstance } from '../connectors-api';

const connectorSkeletonBar = 'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';

export const CONNECTOR_SKELETON_KEYS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] as const;

export function connectorIsInstalled(connector: ConnectorDefinition, instances: ConnectorInstance[]): boolean {
  return instances.some((instance) => instance.connectorId === connector.id);
}

export function ConnectorCardSkeleton() {
  return (
    <div
      className="flex h-full min-h-[11rem] flex-col rounded-xl border border-edge-subtle bg-surface-base p-4 dark:border-edge-subtle"
      aria-hidden
    >
      <div className="flex min-h-0 flex-1 items-start gap-3">
        <div className={cn('size-11 shrink-0 rounded-xl', connectorSkeletonBar)} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className={cn('h-4 min-w-0 flex-1', connectorSkeletonBar)} />
            <div className={cn('h-8 w-[4.5rem] shrink-0 rounded-lg', connectorSkeletonBar)} />
          </div>
          <div className={cn('h-3 w-full', connectorSkeletonBar)} />
          <div className={cn('h-3 w-[88%]', connectorSkeletonBar)} />
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            <div className={cn('h-5 w-16 rounded-full', connectorSkeletonBar)} />
            <div className={cn('h-5 w-20 rounded-full', connectorSkeletonBar)} />
            <div className={cn('h-5 w-14 rounded-full', connectorSkeletonBar)} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function InstalledConnectorRowSkeleton() {
  return (
    <div className="rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface" aria-hidden>
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
}: {
  connector: ConnectorDefinition;
  installed: boolean;
  onInstall: (connector: ConnectorDefinition) => void;
}) {
  const visibleCapabilities = connector.capabilities.slice(0, 4);
  const hiddenCapabilityCount = Math.max(0, connector.capabilities.length - visibleCapabilities.length);

  return (
    <div className="flex min-h-60 flex-col rounded-lg border border-edge bg-surface-panel p-4 shadow-surface transition-colors hover:border-accent/50">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
              <Cable className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-fg">{connector.displayName}</h3>
              <p className="mt-1 text-xs uppercase tracking-wide text-fg-subtle">{connector.category}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {installed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3" aria-hidden />
                Installed
              </span>
            ) : null}
            <span className="rounded-full border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-subtle">
              {connector.source === 'registry' ? 'Registry' : connector.source}
            </span>
          </div>
        </div>

        <p className="mt-4 line-clamp-3 text-sm leading-6 text-fg-muted">{connector.description}</p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {visibleCapabilities.map((capability) => (
            <span key={capability} className="rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted">
              {capability}
            </span>
          ))}
          {hiddenCapabilityCount > 0 ? (
            <span className="rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-subtle">
              +{hiddenCapabilityCount}
            </span>
          ) : null}
        </div>
      </div>

      {connector.tags?.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-edge pt-3">
          {connector.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-fg-subtle">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end">
        <Button
          variant="secondary"
          disabled={installed}
          className="w-full justify-center"
          onClick={() => onInstall(connector)}
        >
          {installed ? <CheckCircle2 className="size-4" /> : <PackagePlus className="size-4" />}
          {installed ? 'Installed' : 'Install'}
        </Button>
      </div>
    </div>
  );
}
