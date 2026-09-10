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
        'flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover/60',
        interaction.transition,
        interaction.focusRingPanel,
        highlighted && 'bg-accent-soft ring-2 ring-inset ring-accent/40',
      )}
      onClick={() => onOpenDetails(instance)}
    >
      <ConnectorLogo connector={definition} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-fg">{instance.displayName}</h3>
          <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', connectionStatus.className)}>
            <connectionStatus.Icon className="size-3.5" aria-hidden />
            {connectionStatus.label}
          </span>
        </div>
        {description ? (
          <p className="mt-1 truncate text-xs text-fg-muted">{description}</p>
        ) : null}
      </div>
      <ChevronRight className="size-4 shrink-0 text-fg-disabled" aria-hidden />
    </button>
  );
}
