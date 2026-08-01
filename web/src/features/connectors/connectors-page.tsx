import { Loader2, Users } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { PopoverSelect } from '@/components/ui/popover-select';
import { RefreshButton } from '@/components/ui/refresh-button';
import { ConnectorCard } from '@/features/connectors/components/connector-card';
import { connectorIsInstalled, CONNECTOR_SKELETON_KEYS } from '@/features/connectors/components/connector-card-data';
import { ConnectorCardSkeleton } from '@/features/connectors/components/connector-card-skeletons';
import { InstalledConnectorRowSkeleton } from '@/features/connectors/components/installed-connector-row-skeleton';
import { ConnectorDetailDialog } from '@/features/connectors/components/connector-detail-dialog';
import { ConnectorRuntimeSettingsDialog } from '@/features/connectors/components/connector-runtime-settings-dialog';
import { ConnectorSearchField, ConnectorsPageHeaderEnd } from '@/features/connectors/components/connectors-page-header-end';
import { CustomMcpServerRow } from '@/features/connectors/components/custom-mcp-server-row';
import { InstalledConnectorDetailDialog } from '@/features/connectors/components/installed-connector-detail-dialog';
import { InstalledConnectorRow } from '@/features/connectors/components/installed-connector-row';
import { InstallConnectorDialog } from '@/features/connectors/components/install-connector-dialog';
import { buildInitialDraft, type InstallDraft } from '@/features/connectors/components/install-connector-draft';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { buildNewCustomServerRow } from './build-new-custom-server-row';
import {
  fetchConnectorCatalog,
  fetchComposioConnectorCatalog,
  fetchConnectorInstances,
  fetchConnectedPeopleGraph,
  fetchStoreConnectorCatalog,
  fetchStoreConnectorInstallPlan,
  type ConnectorDefinition,
  type ConnectorInstance,
  type ConnectedPeopleGraph,
  type StoreConnectorCatalogItem,
} from './connectors-api';
import { CustomMcpServerDialog } from './custom-mcp-server-dialog';
import {
  extractManagedMcpServers,
  normalizeMcpSettingsFromConfig,
  patchMcpSettings,
  type McpServerRow,
} from './mcp/mcp-config-api';
import {
  CONNECTOR_BENEFIT_ORDER,
  connectorBenefitsFor,
  connectorFirstValue,
  type ConnectorBenefit,
} from './utils/connector-benefits';
import {
  customServerMatchesQuery,
  filterAndSortConnectors,
  installedConnectorMatchesQuery,
  isProductConnector,
} from './utils/connector-filters';

type TabId = 'connected' | 'discover';
type ConnectorSort = 'name' | 'source';
type DiscoveryOutcome = 'all' | ConnectorBenefit;

const DISCOVERY_SOURCE_ALL = 'all';
const DISCOVERY_SOURCE_BUILTIN = 'builtin';
const COMPOSIO_CONNECTOR_SOURCE = 'composio';
const STORE_CONNECTOR_SOURCE = 'xopc-store';

type LoadState = {
  catalog: ConnectorDefinition[];
  registryCatalog: ConnectorDefinition[];
  instances: ConnectorInstance[];
  loading: boolean;
  error: string | null;
  peopleGraph: ConnectedPeopleGraph | null;
};

type CustomDialogState =
  | { mode: 'add'; row: McpServerRow }
  | { mode: 'edit'; row: McpServerRow }
  | null;

function connectorFromStoreItem(item: StoreConnectorCatalogItem): ConnectorDefinition {
  const category = ['code', 'docs', 'browser', 'data', 'automation', 'custom'].includes(item.category ?? '')
    ? item.category as ConnectorDefinition['category']
    : 'custom';
  return {
    id: item.name,
    version: item.latestVersion ?? 'store',
    displayName: item.name,
    description: item.description,
    category,
    kind: 'mcp',
    source: 'store',
    capabilities: ['tools', 'runtime.mcp.streamableHttp'],
    tags: ['store'],
    auth: { mode: 'none' },
    setup: {},
    runtime: { type: 'mcp', serverId: `store-${item.name}`.slice(0, 64) },
  };
}

function uniqueConnectors(connectors: ConnectorDefinition[]): ConnectorDefinition[] {
  return connectors.filter((connector, index, all) => (
    all.findIndex((candidate) => candidate.id === connector.id) === index
  ));
}

export function ConnectorsPage() {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const cs = m.connectorsSettings;
  const mcp = m.mcpSettings;
  const token = useGatewayStore((state) => state.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabId>(requestedTab === 'connected' ? 'connected' : 'discover');
  const initialTabResolvedRef = useRef(false);
  const [state, setState] = useState<LoadState>({
    catalog: [],
    registryCatalog: [],
    instances: [],
    loading: true,
    error: null,
    peopleGraph: null,
  });
  const [registryLoading, setRegistryLoading] = useState(false);
  const [storePlanLoading, setStorePlanLoading] = useState(false);
  const [registryPage, setRegistryPage] = useState(1);
  const [registryTotalPages, setRegistryTotalPages] = useState<number | undefined>(undefined);
  const [connectedSearchQuery, setConnectedSearchQuery] = useState('');
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');
  const [peopleSearching, setPeopleSearching] = useState(false);
  const [discoverSearchQuery, setDiscoverSearchQuery] = useState('');
  const [discoverSource, setDiscoverSource] = useState(DISCOVERY_SOURCE_BUILTIN);
  const [connectorSort, setConnectorSort] = useState<ConnectorSort>('name');
  const [selectedOutcome, setSelectedOutcome] = useState<DiscoveryOutcome>('all');
  const [installDraft, setInstallDraft] = useState<InstallDraft | null>(null);
  const [detailConnector, setDetailConnector] = useState<ConnectorDefinition | null>(null);
  const [detailInstanceId, setDetailInstanceId] = useState<string | null>(null);
  const [detailInstanceSnapshot, setDetailInstanceSnapshot] = useState<ConnectorInstance | null>(null);
  const [highlightedInstanceId, setHighlightedInstanceId] = useState<string | null>(null);
  const [customDialog, setCustomDialog] = useState<CustomDialogState>(null);
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false);
  const [sessionIdleTtlMinutes, setSessionIdleTtlMinutes] = useState<number | undefined>(undefined);
  const [ttlSaving, setTtlSaving] = useState(false);

  const { data: configData, mutate: mutateConfig } = useGatewayConfigSwr(hasToken);
  const config = configData?.payload?.config;
  const mcpSettings = useMemo(
    () => (config !== undefined ? normalizeMcpSettingsFromConfig(config) : null),
    [config],
  );
  const customServers = mcpSettings?.servers ?? [];
  const installedCount = state.instances.length + customServers.length;

  useEffect(() => {
    if (mcpSettings) setSessionIdleTtlMinutes(mcpSettings.sessionIdleTtlMinutes);
  }, [mcpSettings]);

  const load = useCallback(async () => {
    if (!token) {
      setState({ catalog: [], registryCatalog: [], instances: [], loading: false, error: null, peopleGraph: null });
      return;
    }
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const [catalog, instances, peopleGraph] = await Promise.all([
        fetchConnectorCatalog(),
        fetchConnectorInstances(),
        fetchConnectedPeopleGraph('', 12).catch(() => null),
      ]);
      setState((previous) => ({
        catalog,
        registryCatalog: previous.registryCatalog,
        instances,
        loading: false,
        error: null,
        peopleGraph,
      }));
    } catch (error) {
      setState({
        catalog: [],
        registryCatalog: [],
        instances: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        peopleGraph: null,
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasToken || tab !== 'connected') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPeopleSearching(true);
      void fetchConnectedPeopleGraph(peopleSearchQuery, 50)
        .then((peopleGraph) => {
          if (!cancelled) setState((previous) => ({ ...previous, peopleGraph }));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setPeopleSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasToken, peopleSearchQuery, tab]);

  useEffect(() => {
    if (initialTabResolvedRef.current || state.loading || (hasToken && !mcpSettings)) return;
    setTab(installedCount > 0 ? 'connected' : 'discover');
    initialTabResolvedRef.current = true;
  }, [hasToken, installedCount, mcpSettings, state.loading]);

  const selectTab = useCallback((nextTab: TabId) => {
    initialTabResolvedRef.current = true;
    setTab(nextTab);
  }, []);

  const marketplaceSources = useMemo(
    () => [
      { id: COMPOSIO_CONNECTOR_SOURCE, displayName: cs.composioSourceName },
      { id: STORE_CONNECTOR_SOURCE, displayName: cs.storeSourceName },
    ],
    [cs.composioSourceName, cs.storeSourceName],
  );

  const searchRegistry = useCallback(async (options?: { page?: number; append?: boolean }) => {
    if (!hasToken || discoverSource === DISCOVERY_SOURCE_BUILTIN) {
      setState((previous) => ({ ...previous, registryCatalog: [] }));
      setRegistryPage(1);
      setRegistryTotalPages(undefined);
      return;
    }
    const query = discoverSearchQuery.trim();
    const page = Math.max(options?.page ?? 1, 1);
    const append = options?.append ?? false;
    const sources = discoverSource === DISCOVERY_SOURCE_ALL
      ? marketplaceSources
      : marketplaceSources.filter((source) => source.id === discoverSource);
    if (sources.length === 0) return;

    setRegistryLoading(true);
    if (!append) {
      setRegistryPage(1);
      setRegistryTotalPages(undefined);
      setState((previous) => ({ ...previous, registryCatalog: [], error: null }));
    } else {
      setState((previous) => ({ ...previous, error: null }));
    }
    try {
      const results = await Promise.all(sources.map(async (source) => {
        if (source.id === COMPOSIO_CONNECTOR_SOURCE) {
          const catalog = await fetchComposioConnectorCatalog({
            q: query || undefined,
            page,
            pageSize: 24,
            verification: 'experimental',
          });
          return { connectors: catalog.connectors, totalPages: catalog.meta.totalPages };
        }
        const catalog = await fetchStoreConnectorCatalog({
          q: query || undefined,
          page,
          pageSize: 24,
          sort: connectorSort === 'source' ? 'newest' : 'downloads',
        });
        return {
          connectors: catalog.items.map(connectorFromStoreItem),
          totalPages: catalog.meta.totalPages,
        };
      }));
      const connectors = uniqueConnectors(results.flatMap((result) => result.connectors));
      const totalPages = Math.max(1, ...results.map((result) => result.totalPages ?? 1));
      setRegistryPage(page);
      setRegistryTotalPages(totalPages);
      setState((previous) => ({
        ...previous,
        registryCatalog: append
          ? uniqueConnectors([...previous.registryCatalog, ...connectors])
          : connectors,
      }));
    } catch (searchError) {
      setState((previous) => ({
        ...previous,
        error: searchError instanceof Error ? searchError.message : String(searchError),
      }));
    } finally {
      setRegistryLoading(false);
    }
  }, [connectorSort, discoverSearchQuery, discoverSource, hasToken, marketplaceSources]);

  useEffect(() => {
    if (tab !== 'discover' || state.loading) return;
    if (discoverSource === DISCOVERY_SOURCE_BUILTIN) {
      setState((previous) => ({ ...previous, registryCatalog: [] }));
      setRegistryPage(1);
      setRegistryTotalPages(undefined);
      return;
    }
    const timeout = window.setTimeout(() => {
      void searchRegistry();
    }, discoverSearchQuery.trim() ? 350 : 0);
    return () => window.clearTimeout(timeout);
  }, [discoverSearchQuery, discoverSource, searchRegistry, state.loading, tab]);

  const installedIds = useMemo(
    () => new Set(state.instances.map((instance) => instance.connectorId)),
    [state.instances],
  );
  const connectorDefinitionsById = useMemo(() => new Map(
    [...state.catalog, ...state.registryCatalog].map((connector) => [connector.id, connector]),
  ), [state.catalog, state.registryCatalog]);

  useEffect(() => {
    if (state.loading) return;
    const connectorId = searchParams.get('connector');
    const requestedInstanceId = searchParams.get('instance');
    if (!connectorId && !requestedInstanceId) return;

    const instance = state.instances.find((candidate) => (
      requestedInstanceId
        ? candidate.instanceId === requestedInstanceId
        : candidate.connectorId === connectorId
    ));
    if (instance) {
      initialTabResolvedRef.current = true;
      setConnectedSearchQuery('');
      setDetailInstanceId(instance.instanceId);
      setDetailInstanceSnapshot(instance);
      setTab('connected');
    } else if (connectorId) {
      const definition = connectorDefinitionsById.get(connectorId);
      if (!definition) return;
      initialTabResolvedRef.current = true;
      setDiscoverSource(DISCOVERY_SOURCE_BUILTIN);
      setDiscoverSearchQuery('');
      setDetailConnector(definition);
      setTab('discover');
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('connector');
    nextParams.delete('instance');
    nextParams.delete('personalContext');
    nextParams.set('tab', instance ? 'connected' : 'discover');
    setSearchParams(nextParams, { replace: true });
  }, [connectorDefinitionsById, searchParams, setSearchParams, state.instances, state.loading]);

  const openStoreInstall = useCallback(async (packageName: string) => {
    setStorePlanLoading(true);
    setState((previous) => ({ ...previous, error: null }));
    try {
      const plan = await fetchStoreConnectorInstallPlan(packageName);
      setInstallDraft(buildInitialDraft(plan.definition, {
        packageName: plan.packageName,
        version: plan.version,
        permissions: plan.permissions,
      }));
    } catch (error) {
      setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setStorePlanLoading(false);
    }
  }, []);

  const managedServerIds = useMemo(
    () => new Set(state.instances.flatMap((instance) => instance.materialized.type === 'mcp' ? [instance.materialized.serverId] : [])),
    [state.instances],
  );

  const removeCustomServer = useCallback(async (row: McpServerRow) => {
    if (!mcpSettings || config === undefined) return;
    const nextServers = customServers.filter((server) => server.clientKey !== row.clientKey);
    await patchMcpSettings(
      { sessionIdleTtlMinutes: mcpSettings.sessionIdleTtlMinutes, servers: nextServers },
      extractManagedMcpServers(config),
    );
    await mutateConfig();
    await load();
  }, [config, customServers, load, mcpSettings, mutateConfig]);

  const openAddCustomServer = useCallback(() => {
    setCustomDialog({ mode: 'add', row: buildNewCustomServerRow(customServers, managedServerIds) });
  }, [customServers, managedServerIds]);

  const saveTtl = useCallback(async () => {
    if (!mcpSettings || config === undefined || ttlSaving) return;
    setTtlSaving(true);
    try {
      await patchMcpSettings(
        { sessionIdleTtlMinutes, servers: customServers },
        extractManagedMcpServers(config),
      );
      await mutateConfig();
      setRuntimeSettingsOpen(false);
    } finally {
      setTtlSaving(false);
    }
  }, [config, customServers, mcp.saved, mcpSettings, mutateConfig, sessionIdleTtlMinutes, ttlSaving]);

  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const headerEnd = useMemo(() => (
    <ConnectorsPageHeaderEnd
      onBrowseCatalog={() => selectTab('discover')}
      onAddCustomServer={openAddCustomServer}
      onOpenRuntimeSettings={() => setRuntimeSettingsOpen(true)}
      addLabel={cs.addConnection}
      browseLabel={cs.addFromCatalog}
      customLabel={cs.addCustomServerAdvanced}
      settingsLabel={cs.runtimeSettings}
    />
  ), [cs, openAddCustomServer, selectTab]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{cs.title}</h1>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, cs.title, headerEnd, setPageHeader]);

  const connectedValue = useMemo(() => state.instances.map((instance) => ({
    instance,
    value: connectorFirstValue(instance, connectorDefinitionsById.get(instance.connectorId)),
  })), [connectorDefinitionsById, state.instances]);
  const instanceValueById = useMemo(
    () => new Map(connectedValue.map(({ instance, value }) => [instance.instanceId, value])),
    [connectedValue],
  );
  const visibleInstances = useMemo(() => state.instances
    .filter((instance) => installedConnectorMatchesQuery(instance, connectedSearchQuery))
    .sort((left, right) => {
      const priority = { needs_setup: 0, checking: 1, ready: 2 } as const;
      const leftState = instanceValueById.get(left.instanceId)?.state ?? 'checking';
      const rightState = instanceValueById.get(right.instanceId)?.state ?? 'checking';
      return priority[leftState] - priority[rightState] || left.displayName.localeCompare(right.displayName);
    }), [connectedSearchQuery, instanceValueById, state.instances]);
  const visibleCustomServers = useMemo(
    () => customServers.filter((row) => customServerMatchesQuery(row, connectedSearchQuery)),
    [connectedSearchQuery, customServers],
  );
  const visibleInstalledCount = visibleInstances.length + visibleCustomServers.length;

  const builtinCatalog = useMemo(
    () => state.catalog.filter((connector) => (
      connector.source === 'builtin'
      && connector.integrationStrategy?.preferred !== false
      && isProductConnector(connector)
    )),
    [state.catalog],
  );
  const discoverySourceCatalog = useMemo(() => (
    discoverSource === DISCOVERY_SOURCE_BUILTIN
      ? builtinCatalog
      : discoverSource === DISCOVERY_SOURCE_ALL
        ? uniqueConnectors([...builtinCatalog, ...state.registryCatalog])
        : state.registryCatalog
  ), [builtinCatalog, discoverSource, state.registryCatalog]);
  const discoveryCatalog = useMemo(() => {
    const filtered = selectedOutcome === 'all'
      ? discoverySourceCatalog
      : discoverySourceCatalog.filter((connector) => connectorBenefitsFor(connector).includes(selectedOutcome));
    return filterAndSortConnectors(filtered, discoverSearchQuery, connectorSort);
  }, [connectorSort, discoverSearchQuery, discoverySourceCatalog, selectedOutcome]);
  const availableOutcomes = useMemo(() => CONNECTOR_BENEFIT_ORDER.filter((benefit) => (
    discoverySourceCatalog.some((connector) => connectorBenefitsFor(connector).includes(benefit))
  )), [discoverySourceCatalog]);

  useEffect(() => {
    if (selectedOutcome !== 'all' && !availableOutcomes.includes(selectedOutcome)) setSelectedOutcome('all');
  }, [availableOutcomes, selectedOutcome]);
  const registryCanLoadMore = tab === 'discover'
    && discoverSource !== DISCOVERY_SOURCE_BUILTIN
    && Boolean(registryTotalPages && registryPage < registryTotalPages);
  const detailInstance = useMemo(
    () => state.instances.find((instance) => instance.instanceId === detailInstanceId) ?? detailInstanceSnapshot,
    [detailInstanceId, detailInstanceSnapshot, state.instances],
  );
  const sourceOptions = useMemo(() => [
    { value: DISCOVERY_SOURCE_ALL, label: cs.discoverSourceAll },
    { value: DISCOVERY_SOURCE_BUILTIN, label: cs.discoverSourceBuiltin },
    ...marketplaceSources.map((source) => ({ value: source.id, label: source.displayName })),
  ], [cs.discoverSourceAll, cs.discoverSourceBuiltin, marketplaceSources]);
  const tabItems = [
    { id: 'connected' as const, label: cs.tabConnected, count: installedCount },
    { id: 'discover' as const, label: cs.tabDiscover },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className="flex w-full flex-col gap-6 px-3 py-6 sm:px-5 xl:px-6">
        {!hasToken ? (
          <p className="rounded-xl border border-edge bg-surface-panel px-4 py-3 text-sm text-fg-muted">{cs.tokenHint}</p>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="border-b border-edge-subtle pb-3 dark:border-edge-subtle">
            <PageTabs
              items={tabItems}
              activeTab={tab}
              onChange={selectTab}
              ariaLabel={cs.navAria}
              tabIdPrefix="connectors-tab"
              panelIdPrefix="connectors-panel"
              className="flex-wrap"
            />
          </div>

          {state.error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{state.error}</p> : null}

          {tab === 'connected' && hasToken ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <ConnectorSearchField
                  value={connectedSearchQuery}
                  onChange={setConnectedSearchQuery}
                  placeholder={cs.connectedSearchPlaceholder}
                  className="max-w-xl"
                />
                <RefreshButton
                  className="size-9 shrink-0 p-0"
                  loading={state.loading}
                  label={cs.refreshConnections}
                  title={cs.refreshConnections}
                  onClick={load}
                />
              </div>

              {state.peopleGraph && (state.peopleGraph.people.length > 0 || peopleSearchQuery) ? (
                <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-accent-soft p-2 text-accent-fg">
                      <Users className="size-4" aria-hidden />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-fg">{cs.peopleGraphTitle}</h2>
                      <p className="mt-1 text-xs text-fg-muted">
                        {cs.peopleGraphHint
                          .replace('{{people}}', String(state.peopleGraph.people.length))
                          .replace('{{sources}}', String(new Set(state.peopleGraph.sourceEdges.map((edge) => edge.sourceInstanceId)).size))}
                      </p>
                    </div>
                    </div>
                    <div className="relative w-full max-w-xs">
                      <ConnectorSearchField
                        value={peopleSearchQuery}
                        onChange={setPeopleSearchQuery}
                        placeholder={cs.peopleGraphSearchPlaceholder}
                      />
                      {peopleSearching ? <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-fg-subtle" aria-hidden /> : null}
                    </div>
                  </div>
                  {state.peopleGraph.people.length ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {state.peopleGraph.people.slice(0, 10).map((person) => {
                        const sourceLabels = [...new Set(state.peopleGraph!.sourceEdges
                          .filter((edge) => edge.personId === person.id)
                          .map((edge) => edge.toolkit ?? edge.connectorId ?? edge.sourceInstanceId))];
                        return (
                          <div key={person.id} className="rounded-xl border border-edge bg-surface-panel px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <p className="truncate text-sm font-medium text-fg">{person.label}</p>
                              <span className="shrink-0 text-xs text-fg-subtle">{person.mentionCount}</span>
                            </div>
                            <p className="mt-1 truncate text-xs text-fg-muted">
                              {person.emails[0] ?? person.usernames[0] ?? person.roles.join(' · ')}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-fg-subtle">{sourceLabels.join(' · ')}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="mt-4 text-sm text-fg-muted">{cs.peopleGraphSearchEmpty}</p>}
                </section>
              ) : null}

              {state.loading ? (
                <div className="grid gap-3" aria-busy="true" aria-label={cs.loading}>
                  {CONNECTOR_SKELETON_KEYS.slice(0, 3).map((key) => <InstalledConnectorRowSkeleton key={key} />)}
                </div>
              ) : installedCount === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge p-8 text-center">
                  <p className="text-sm text-fg-muted">{cs.connectionsEmpty}</p>
                  <Button type="button" variant="primary" className="mt-4" onClick={() => selectTab('discover')}>{cs.addFromCatalog}</Button>
                </div>
              ) : visibleInstalledCount === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">{cs.connectionsSearchEmpty}</div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleInstances.map((instance) => (
                    <InstalledConnectorRow
                      key={instance.instanceId}
                      instance={instance}
                      definition={connectorDefinitionsById.get(instance.connectorId)}
                      highlighted={instance.instanceId === highlightedInstanceId}
                      onOpenDetails={(selected) => {
                        setHighlightedInstanceId(null);
                        setDetailInstanceId(selected.instanceId);
                        setDetailInstanceSnapshot(selected);
                      }}
                      onChanged={load}
                      t={cs}
                    />
                  ))}
                  {visibleCustomServers.map((row) => (
                    <CustomMcpServerRow
                      key={row.clientKey}
                      row={row}
                      t={mcp}
                      cs={cs}
                      onEdit={() => setCustomDialog({ mode: 'edit', row: structuredClone(row) })}
                      onRemove={async () => removeCustomServer(row)}
                    />
                  ))}
                </div>
              )}
              <p className="text-xs text-fg-subtle">{mcp.disableHint}</p>
            </div>
          ) : null}

          {tab === 'discover' && hasToken ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2" role="group" aria-label={cs.outcomeFilterAria}>
                {(['all', ...availableOutcomes] as DiscoveryOutcome[]).map((outcome) => (
                  <button
                    key={outcome}
                    type="button"
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      selectedOutcome === outcome
                        ? 'border-accent/40 bg-accent-soft text-accent-fg'
                        : 'border-edge bg-surface-panel text-fg-muted hover:bg-surface-hover hover:text-fg',
                    )}
                    aria-pressed={selectedOutcome === outcome}
                    onClick={() => setSelectedOutcome(outcome)}
                  >
                    {outcome === 'all' ? cs.outcomeAll : cs.connectorBenefitHeadings[outcome]}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <ConnectorSearchField
                  value={discoverSearchQuery}
                  onChange={setDiscoverSearchQuery}
                  placeholder={cs.discoverSearchPlaceholder}
                  className="max-w-xl"
                />
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:ml-auto lg:w-[26rem]">
                  <PopoverSelect
                    value={discoverSource}
                    options={sourceOptions}
                    placeholder={cs.discoverSourceAll}
                    allowEmpty={false}
                    ariaLabel={cs.registrySourceAria}
                    triggerClassName="h-9 bg-surface-panel text-xs"
                    onChange={setDiscoverSource}
                  />
                  <PopoverSelect
                    value={connectorSort}
                    options={[
                      { value: 'name', label: cs.sortName },
                      { value: 'source', label: cs.sortSource },
                    ]}
                    placeholder={cs.sortName}
                    allowEmpty={false}
                    ariaLabel={cs.sortAria}
                    triggerClassName="h-9 bg-surface-panel text-xs"
                    onChange={(value) => setConnectorSort(value as ConnectorSort)}
                  />
                </div>
              </div>

              {(state.loading || registryLoading) && discoveryCatalog.length === 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={cs.loading}>
                  {CONNECTOR_SKELETON_KEYS.map((key) => <ConnectorCardSkeleton key={key} />)}
                </div>
              ) : discoveryCatalog.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">{cs.discoverEmpty}</div>
              ) : (
                <div className="relative">
                  {registryLoading ? (
                    <div className="pointer-events-none absolute inset-0 z-[1] flex justify-center bg-surface-panel/40 pt-[min(28vh,7.5rem)] backdrop-blur-[1px] motion-reduce:backdrop-blur-none dark:bg-surface-base/35" aria-busy="true" aria-label={cs.loading}>
                      <Loader2 className="size-8 shrink-0 animate-spin text-accent motion-reduce:animate-none" strokeWidth={2} aria-hidden />
                    </div>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {discoveryCatalog.map((connector) => (
                      <ConnectorCard
                        key={connector.id}
                        connector={connector}
                        installed={installedIds.has(connector.id) || connectorIsInstalled(connector, state.instances)}
                        onInstall={(selected) => {
                          if (selected.source === 'store') {
                            void openStoreInstall(selected.id);
                            return;
                          }
                          setInstallDraft(buildInitialDraft(selected));
                        }}
                        onOpenDetails={connector.source === 'store' ? undefined : setDetailConnector}
                        t={cs}
                      />
                    ))}
                  </div>
                  {registryCanLoadMore ? (
                    <div className="mt-4 flex justify-center">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={registryLoading || storePlanLoading}
                        onClick={() => void searchRegistry({ page: registryPage + 1, append: true })}
                      >
                        {registryLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                        {cs.loadMore}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </section>

        {installDraft ? (
          <InstallConnectorDialog
            draft={installDraft}
            onChange={setInstallDraft}
            onClose={() => setInstallDraft(null)}
            t={cs}
            onInstalled={async (instance) => {
              await load();
              await mutateConfig();
              setHighlightedInstanceId(instance.instanceId);
              selectTab('connected');
            }}
          />
        ) : null}

        {detailConnector ? (
          <ConnectorDetailDialog
            connector={detailConnector}
            installed={installedIds.has(detailConnector.id) || connectorIsInstalled(detailConnector, state.instances)}
            onClose={() => setDetailConnector(null)}
            onInstall={(selected) => setInstallDraft(buildInitialDraft(selected))}
            t={cs}
          />
        ) : null}

        {detailInstance ? (
          <InstalledConnectorDetailDialog
            instance={detailInstance}
            definition={connectorDefinitionsById.get(detailInstance.connectorId)}
            onClose={() => {
              setDetailInstanceId(null);
              setDetailInstanceSnapshot(null);
            }}
            onChanged={load}
            t={cs}
            mcp={mcp}
          />
        ) : null}

        {customDialog ? (
          <CustomMcpServerDialog
            key={`${customDialog.mode}-${customDialog.row.clientKey}`}
            open
            mode={customDialog.mode}
            initialRow={customDialog.row}
            existingCustomServers={customServers}
            sessionIdleTtlMinutes={sessionIdleTtlMinutes}
            config={config}
            managedServerIds={managedServerIds}
            t={mcp}
            cs={cs}
            onClose={() => setCustomDialog(null)}
            onSaved={async () => {
              await mutateConfig();
              await load();
              selectTab('connected');
            }}
          />
        ) : null}

        <ConnectorRuntimeSettingsDialog
          open={runtimeSettingsOpen}
          sessionIdleTtlMinutes={sessionIdleTtlMinutes}
          saving={ttlSaving}
          onChange={setSessionIdleTtlMinutes}
          onSave={saveTtl}
          onClose={() => setRuntimeSettingsOpen(false)}
          t={cs}
          mcp={mcp}
        />
      </div>
    </div>
  );
}
