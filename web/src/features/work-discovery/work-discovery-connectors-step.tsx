import { CheckCircle2, ChevronDown, ChevronUp, Loader2, PlugZap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchComposioConnectorCatalog,
  fetchConnectorInstances,
  type ConnectorDefinition,
  type ConnectorInstance,
} from '@/features/connectors/connectors-api';
import { ConnectorLogo } from '@/features/connectors/components/connector-logo';
import { InstallConnectorDialog } from '@/features/connectors/components/install-connector-dialog';
import { buildInitialDraft, type InstallDraft } from '@/features/connectors/components/install-connector-draft';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { UnderstandingSignal, UnderstandingSignalKind } from './understanding-source-convergence';

const POPULAR_TOOLKITS = ['gmail', 'googlecalendar', 'googledrive'] as const;
const UNDERSTANDING_TOOLKIT_ORDER = [...POPULAR_TOOLKITS, 'github', 'linear'] as const;
const INSTANCE_STATUS_GRACE_MS = 2_500;

function onboardingConnector({
  toolkit,
  displayName,
  description,
  category,
  mode,
  bootstrapWindowDays,
  logoFileName = toolkit,
}: {
  toolkit: string;
  displayName: string;
  description: string;
  category: ConnectorDefinition['category'];
  mode: NonNullable<ConnectorDefinition['understanding']>['mode'];
  bootstrapWindowDays: number;
  logoFileName?: string;
}): ConnectorDefinition {
  return {
    id: `composio-${toolkit}`,
    version: 'sessions-v1',
    displayName,
    description,
    category,
    kind: 'composio',
    source: 'registry',
    capabilities: ['tools', 'auth.oauth', 'events', 'workflows', 'context', 'memory_source'],
    benefits: ['understand', 'act'],
    understanding: { mode, bootstrapWindowDays, readOnly: true },
    tags: ['composio', toolkit, 'verified'],
    branding: {
      logoUrl: `/connector-icons/${logoFileName}.svg`,
      source: 'builtin',
    },
    verificationLevel: 'verified',
    auth: { mode: 'oauth', provider: 'composio' },
    setup: {},
    runtime: { type: 'composio', toolkit, role: 'toolkit' },
    integrationStrategy: { lane: 'composio', workload: 'long_tail', preferred: true },
  };
}

export const ONBOARDING_CONNECTOR_FALLBACKS: ConnectorDefinition[] = [
  onboardingConnector({
    toolkit: 'gmail',
    displayName: 'Gmail',
    description: 'Find and understand recent email, then draft or send with your approval.',
    category: 'automation',
    mode: 'activity',
    bootstrapWindowDays: 30,
  }),
  onboardingConnector({
    toolkit: 'googlecalendar',
    displayName: 'Google Calendar',
    description: 'Understand your schedule and work with approved calendar events.',
    category: 'automation',
    mode: 'activity',
    bootstrapWindowDays: 90,
    logoFileName: 'google-calendar',
  }),
  onboardingConnector({
    toolkit: 'googledrive',
    displayName: 'Google Drive',
    description: 'Search and understand approved files in Google Drive.',
    category: 'data',
    mode: 'inventory',
    bootstrapWindowDays: 90,
    logoFileName: 'google-drive',
  }),
  onboardingConnector({
    toolkit: 'github',
    displayName: 'GitHub',
    description: 'Understand repositories, issues, pull requests, and reviews.',
    category: 'code',
    mode: 'activity',
    bootstrapWindowDays: 90,
  }),
  onboardingConnector({
    toolkit: 'linear',
    displayName: 'Linear',
    description: 'Understand and work with Linear issues and projects.',
    category: 'code',
    mode: 'activity',
    bootstrapWindowDays: 60,
  }),
];

function toolkitFor(connector: ConnectorDefinition): string {
  return connector.runtime.type === 'composio' && connector.runtime.role === 'toolkit'
    ? connector.runtime.toolkit.toLocaleLowerCase()
    : '';
}

function connected(instance: ConnectorInstance | undefined): boolean {
  return Boolean(instance?.enabled && (
    instance.status === 'connected'
    || instance.connectionStatus === 'connected'
    || instance.authStatus === 'connected'
  ));
}

function signalKind(toolkit: string): UnderstandingSignalKind {
  if (toolkit === 'gmail') return 'mail';
  if (toolkit === 'googlecalendar') return 'calendar';
  if (toolkit === 'googledrive') return 'data';
  if (toolkit === 'github') return 'git';
  if (toolkit === 'linear') return 'task';
  return 'service';
}

export function sortUnderstandingConnectors(connectors: ConnectorDefinition[]): ConnectorDefinition[] {
  const order = new Map<string, number>(UNDERSTANDING_TOOLKIT_ORDER.map((toolkit, index) => [toolkit, index]));
  return connectors
    .filter((connector) => connector.understanding != null && toolkitFor(connector))
    .sort((left, right) => (
      (order.get(toolkitFor(left)) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(toolkitFor(right)) ?? Number.MAX_SAFE_INTEGER)
      || left.displayName.localeCompare(right.displayName)
    ));
}

export function mergeUnderstandingConnectors(
  fallbackConnectors: ConnectorDefinition[],
  catalogConnectors: ConnectorDefinition[],
): ConnectorDefinition[] {
  const merged = new Map(fallbackConnectors.map((connector) => [connector.id, connector]));
  for (const connector of catalogConnectors) merged.set(connector.id, connector);
  return sortUnderstandingConnectors([...merged.values()]);
}

export function WorkDiscoveryConnectorsStep({
  busy,
  onBack,
  onContinue,
  onSkip,
  onConnectedSignalsChange,
}: {
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
  onConnectedSignalsChange: (signals: UnderstandingSignal[]) => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const allMessages = messages(language);
  const copy = allMessages.onboarding.workDiscovery;
  const connectorCopy = allMessages.connectorsSettings;
  const [catalog, setCatalog] = useState<ConnectorDefinition[]>(() => sortUnderstandingConnectors(ONBOARDING_CONNECTOR_FALLBACKS));
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [installDraft, setInstallDraft] = useState<InstallDraft | null>(null);

  const loadInstances = useCallback(async () => {
    const next = await fetchConnectorInstances();
    setInstances(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const graceTimer = window.setTimeout(() => {
      if (!cancelled) setInstancesLoading(false);
    }, INSTANCE_STATUS_GRACE_MS);

    void fetchConnectorInstances().then((instanceResult) => {
      if (!cancelled) setInstances(instanceResult);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setInstancesLoading(false);
      window.clearTimeout(graceTimer);
    });

    void fetchComposioConnectorCatalog({ page: 1, pageSize: 24, verification: 'verified' })
      .then((catalogResult) => {
        if (!cancelled) {
          setCatalog(mergeUnderstandingConnectors(ONBOARDING_CONNECTOR_FALLBACKS, catalogResult.connectors));
        }
      })
      .catch(() => {
        // The bundled onboarding catalog remains usable when the remote catalog is unavailable.
      });

    return () => {
      cancelled = true;
      window.clearTimeout(graceTimer);
    };
  }, []);

  const instanceByConnectorId = useMemo(
    () => new Map(instances.map((instance) => [instance.connectorId, instance])),
    [instances],
  );
  const connectedSignals = useMemo(() => catalog.flatMap((connector): UnderstandingSignal[] => {
    if (!connected(instanceByConnectorId.get(connector.id))) return [];
    const toolkit = toolkitFor(connector);
    return [{ id: connector.id, label: connector.displayName, kind: signalKind(toolkit) }];
  }), [catalog, instanceByConnectorId]);

  useEffect(() => {
    onConnectedSignalsChange(connectedSignals);
  }, [connectedSignals, onConnectedSignalsChange]);

  const visibleCatalog = expanded ? catalog : catalog.slice(0, 3);
  const connectedCount = connectedSignals.length;

  return (
    <section className="mx-auto flex w-full max-w-[42rem] flex-1 flex-col" aria-labelledby="work-discovery-connectors-title">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">{copy.connectorStepEyebrow}</p>
        <h1 id="work-discovery-connectors-title" className="mt-2 text-2xl font-semibold tracking-tight text-fg">{copy.connectorStepTitle}</h1>
        <p className="mx-auto mt-3 max-w-[36rem] text-[0.95rem] leading-7 text-fg-muted">{copy.connectorStepSubtitle}</p>
      </div>

      <div className="mt-7 rounded-2xl border border-edge bg-surface-panel p-3 shadow-surface sm:p-4">
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">{copy.popularWorkServices}</h2>
            <p className="mt-1 text-xs text-fg-muted">{copy.connectorsOptional}</p>
          </div>
          {connectedCount ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
              <CheckCircle2 className="size-3.5" />{copy.connectedCount.replace('{{count}}', String(connectedCount))}
            </span>
          ) : null}
        </div>

        {visibleCatalog.length ? (
          <div className="divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge-subtle bg-surface-base/55">
            {visibleCatalog.map((connector) => {
              const instance = instanceByConnectorId.get(connector.id);
              const isConnected = connected(instance);
              return (
                <article key={connector.id} className="flex min-h-[4.75rem] items-center gap-3 px-3 py-3 sm:px-4">
                  <ConnectorLogo connector={connector} size="sm" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-fg">{connector.displayName}</h3>
                    <p className="mt-1 line-clamp-1 text-xs text-fg-muted">{connector.description}</p>
                  </div>
                  {isConnected ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 className="size-4" />{copy.connected}</span>
                  ) : instancesLoading ? (
                    <span className="inline-flex h-8 w-[4.5rem] shrink-0 items-center justify-center text-fg-muted" aria-label={connectorCopy.loading}>
                      <Loader2 className="size-4 animate-spin" />
                    </span>
                  ) : (
                    <Button type="button" variant="secondary" className="h-8 shrink-0 px-3 text-xs" onClick={() => setInstallDraft(buildInitialDraft(connector))}>
                      <PlugZap className="size-3.5" />{connectorCopy.connect}
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-edge px-4 py-8 text-center text-sm text-fg-muted">{copy.noWorkServices}</p>
        )}

        {catalog.length > 3 ? (
          <button type="button" className="mx-auto mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-fg hover:underline" onClick={() => setExpanded((current) => !current)}>
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? copy.showFewerServices : copy.showMoreServices}
          </button>
        ) : null}
        {error ? <p className="mt-3 text-center text-xs text-danger" role="alert">{copy.connectorLoadFailed}: {error}</p> : null}
      </div>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse">
        <Button type="button" variant="primary" className="h-11 flex-1" disabled={busy} onClick={onContinue}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}{copy.startUnderstanding}
        </Button>
        <Button type="button" variant="secondary" className="h-11 flex-1" disabled={busy} onClick={onBack}>{copy.back}</Button>
      </div>
      <button type="button" className="mx-auto mt-6 text-sm text-fg-muted hover:text-fg hover:underline" disabled={busy} onClick={onSkip}>{copy.skipAndEnter}</button>

      {installDraft ? (
        <InstallConnectorDialog
          draft={installDraft}
          onChange={setInstallDraft}
          onClose={() => setInstallDraft(null)}
          t={connectorCopy}
          onInstalled={async () => {
            await loadInstances();
            setInstallDraft(null);
          }}
        />
      ) : null}
    </section>
  );
}
