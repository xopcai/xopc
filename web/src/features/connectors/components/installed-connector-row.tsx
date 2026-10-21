import { AlertCircle, CheckCircle2, ChevronRight, Clock3 } from 'lucide-react';

import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { ConnectorDefinition, ConnectorInstance } from '../connectors-api';
import { connectorFirstValue } from '../utils/connector-benefits';
import { connectorDescription } from '../utils/connector-copy';
import { ConnectorLogo } from './connector-logo';

export function InstalledConnectorRow({
  instance,
  definition,
  highlighted = false,
  onOpenDetails,
  t,
}: {
  instance: ConnectorInstance;
  definition?: ConnectorDefinition;
  highlighted?: boolean;
  onOpenDetails: (instance: ConnectorInstance) => void;
  t: ConnectorsSettingsMessages;
}) {
  const connectionState = connectorFirstValue(instance, definition).state;
  const description = definition ? connectorDescription(definition, t) : null;
  const connectionStatus = connectionState === 'ready'
    ? { label: t.connectionReady, Icon: CheckCircle2, className: 'text-emerald-700 dark:text-emerald-300' }
    : connectionState === 'needs_setup'
      ? { label: t.connectionNeedsSetup, Icon: AlertCircle, className: 'text-amber-700 dark:text-amber-300' }
      : { label: t.connectionChecking, Icon: Clock3, className: 'text-fg-muted' };

  return (
    <button
      type="button"
      className={cn(
        'flex min-h-[8.75rem] w-full min-w-0 flex-col rounded-xl border border-edge bg-surface-panel p-4 text-left hover:bg-surface-hover/45',
        interaction.transition,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        connectionState === 'needs_setup' && 'border-amber-500/25',
        highlighted && 'bg-accent-soft',
      )}
      onClick={() => onOpenDetails(instance)}
    >
      <div className="flex w-full min-w-0 items-start gap-3">
        <ConnectorLogo connector={definition} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg" title={instance.displayName}>{instance.displayName}</h3>
          <span className={cn('mt-1 inline-flex items-center gap-1 text-[11px]', connectionStatus.className)}>
            <connectionStatus.Icon className="size-3.5" aria-hidden />
            {connectionStatus.label}
          </span>
        </div>
      </div>
      {description ? <p className="mt-2 w-full line-clamp-2 text-xs leading-5 text-fg-muted" title={description}>{description}</p> : null}
      <span className="mt-auto flex w-full items-center justify-end gap-1 pt-2 text-xs text-fg-muted">
        {t.installedDetails}
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      </span>
    </button>
  );
}
