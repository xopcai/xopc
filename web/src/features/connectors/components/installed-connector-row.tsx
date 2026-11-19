import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react';

import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import type { ConnectorDefinition, ConnectorInstance } from '../connectors-api';
import { connectorFirstValue } from '../utils/connector-benefits';
import { connectorDescription } from '../utils/connector-copy';
import { ConnectionSummaryCard } from './connection-summary-card';
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
    <ConnectionSummaryCard
      name={instance.displayName}
      icon={<ConnectorLogo connector={definition} size="sm" />}
      status={<span className={cn('mt-1 inline-flex items-center gap-1 text-[11px]', connectionStatus.className)}>
        <connectionStatus.Icon className="size-3.5" aria-hidden />
        {connectionStatus.label}
      </span>}
      description={description}
      action={t.installedDetails}
      highlighted={highlighted}
      onOpen={() => onOpenDetails(instance)}
    />
  );
}
