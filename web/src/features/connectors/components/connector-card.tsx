import { CheckCircle2, PackagePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import type { ConnectorDefinition } from '../connectors-api';
import { connectorDescription } from '../utils/connector-copy';
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
  const visibleCapabilities = humanCapabilities.slice(0, 2);
  const hiddenCapabilityCount = Math.max(0, humanCapabilities.length - visibleCapabilities.length);
  const actionLabel = t.connect;
  const description = connectorDescription(connector, t);
  const verificationLabel = connector.verificationLevel === 'verified'
    ? t.connectorVerified
    : connector.verificationLevel === 'beta'
      ? t.connectorBeta
      : connector.verificationLevel === 'experimental'
        ? t.connectorExperimental
        : null;
  const renderInstallButton = (className?: string) => (
    <Button
      type="button"
      variant="primary"
      className={cn('h-8 justify-center px-2.5 text-xs font-medium', className)}
      onClick={() => onInstall(connector)}
    >
      <PackagePlus className="size-4" />
      {actionLabel}
    </Button>
  );
  return (
    <div
      className="group flex min-h-[8.75rem] flex-col rounded-xl border border-edge bg-surface-panel p-4 transition-colors hover:bg-surface-hover/45 focus-within:ring-2 focus-within:ring-accent/30"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <ConnectorLogo connector={connector} />
            <div className="min-w-0">
              {onOpenDetails ? (
                <button type="button" className="block max-w-full truncate text-left text-sm font-semibold text-fg hover:underline" onClick={() => onOpenDetails(connector)}>
                  {connector.displayName}
                </button>
              ) : <h3 className="truncate text-sm font-semibold text-fg">{connector.displayName}</h3>}
              {verificationLabel ? (
                <span className="mt-1 inline-flex rounded-full border border-edge px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
                  {verificationLabel}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {!installed ? (
              <div className="hidden shrink-0 items-center gap-1 sm:flex">
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

        <p className="mt-3 line-clamp-2 text-sm leading-6 text-fg-muted" title={description}>
          {description}
        </p>

        {visibleCapabilities.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
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
