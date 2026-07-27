import { CheckCircle2, PackagePlus } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import type { ConnectorDefinition } from '../connectors-api';
import { ConnectorLogo } from './connector-logo';

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
  const humanCapabilities = connector.capabilities
    .filter((capability) => !capability.startsWith('runtime.') && !capability.startsWith('auth.'));
  const visibleCapabilities = humanCapabilities.slice(0, 3);
  const hiddenCapabilityCount = Math.max(0, humanCapabilities.length - visibleCapabilities.length);
  const actionLabel = t.connect;
  const verificationLabel = connector.verificationLevel === 'verified'
    ? t.connectorVerified
    : connector.verificationLevel === 'beta'
      ? t.connectorBeta
      : connector.verificationLevel === 'experimental'
        ? t.connectorExperimental
        : null;
  const strategyLabel = connector.integrationStrategy?.lane === 'native'
    ? t.integrationStrategyNative
    : connector.integrationStrategy?.lane === 'mcp'
      ? t.integrationStrategyMcp
      : connector.integrationStrategy?.lane === 'composio'
        ? t.integrationStrategyComposio
        : null;
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
      {actionLabel}
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
            <ConnectorLogo connector={connector} />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-fg">{connector.displayName}</h3>
              {verificationLabel ? (
                <span className="mt-1 inline-flex rounded-full border border-edge px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
                  {verificationLabel}
                </span>
              ) : null}
              {strategyLabel ? (
                <span className="ml-1 mt-1 inline-flex rounded-full border border-accent/20 bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-fg">
                  {strategyLabel}
                </span>
              ) : null}
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
                {t.connectedBadge}
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
                {t.connectorCapabilityLabels[capability] ?? capability}
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
