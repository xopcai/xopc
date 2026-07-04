import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Funnel, Loader2, Plug } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { ConnectorCard, ConnectorCardSkeleton, connectorIsInstalled, CONNECTOR_SKELETON_KEYS, InstalledConnectorRowSkeleton } from '@/features/connectors/components/connector-card';
import { ConnectorsPageHeaderEnd } from '@/features/connectors/components/connectors-page-header-end';
import { CustomMcpServerRow } from '@/features/connectors/components/custom-mcp-server-row';
import { InstalledConnectorRow } from '@/features/connectors/components/installed-connector-row';
import { buildInitialDraft, InstallConnectorDialog, type InstallDraft } from '@/features/connectors/components/install-connector-dialog';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';
import { showToast } from '@/lib/toast';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { buildNewCustomServerRow } from './build-new-custom-server-row';
import { customServerMatchesQuery, filterAndSortConnectors, installedConnectorMatchesQuery } from './utils/connector-filters';
import {
  CustomMcpServerDialog,
} from './custom-mcp-server-dialog';
import {
  extractManagedMcpServers,
  normalizeMcpSettingsFromConfig,
  patchMcpSettings,
  type McpServerRow,
} from './mcp/mcp-config-api';
import {
  fetchConnectorCatalog,
  fetchConnectorInstances,
  fetchConnectorRegistries,
  searchConnectorRegistryPage,
  type ConnectorDefinition,
  type ConnectorInstance,
  type ConnectorRegistryProvider,
} from './connectors-api';

type TabId = 'marketplace' | 'builtin' | 'user' | 'config';
type ConnectorSort = 'name' | 'source';

const CONNECTOR_REGISTRY_PROVIDER_PARAM = 'mprov';
const DEFAULT_CONNECTOR_REGISTRY_SOURCE = 'smithery';
type LoadState = {
  catalog: ConnectorDefinition[];
  registryCatalog: ConnectorDefinition[];
  instances: ConnectorInstance[];
  registries: ConnectorRegistryProvider[];
  loading: boolean;
  error: string | null;
};

type CustomDialogState =
  | { mode: 'add'; row: McpServerRow }
  | { mode: 'edit'; row: McpServerRow }
  | null;

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

export function ConnectorsPage() {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const cs = m.connectorsSettings;
  const mcp = m.mcpSettings;
  const token = useGatewayStore((state) => state.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlRegistrySource = searchParams.get(CONNECTOR_REGISTRY_PROVIDER_PARAM)?.trim() || DEFAULT_CONNECTOR_REGISTRY_SOURCE;
  const [tab, setTab] = useState<TabId>('marketplace');
  const [state, setState] = useState<LoadState>({ catalog: [], registryCatalog: [], instances: [], registries: [], loading: true, error: null });
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryPage, setRegistryPage] = useState(1);
  const [registryTotalPages, setRegistryTotalPages] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [registrySource, setRegistrySource] = useState(urlRegistrySource);
  const [connectorSort, setConnectorSort] = useState<ConnectorSort>('name');
  const [installDraft, setInstallDraft] = useState<InstallDraft | null>(null);
  const [customDialog, setCustomDialog] = useState<CustomDialogState>(null);
  const [sessionIdleTtlMinutes, setSessionIdleTtlMinutes] = useState<number | undefined>(undefined);
  const [ttlSaving, setTtlSaving] = useState(false);
  const [_ttlSaved, setTtlSaved] = useState(false);

  const { data: configData, mutate: mutateConfig } = useGatewayConfigSwr(hasToken);
  const config = configData?.payload?.config;
  const mcpSettings = useMemo(
    () => (config !== undefined ? normalizeMcpSettingsFromConfig(config) : null),
    [config],
  );
  const customServers = mcpSettings?.servers ?? [];

  useEffect(() => {
    if (mcpSettings) {
      setSessionIdleTtlMinutes(mcpSettings.sessionIdleTtlMinutes);
    }
  }, [mcpSettings]);

  const load = useCallback(async () => {
    if (!token) {
      setState({ catalog: [], registryCatalog: [], instances: [], registries: [], loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [catalog, instances, registries] = await Promise.all([
        fetchConnectorCatalog(),
        fetchConnectorInstances(),
        fetchConnectorRegistries(),
      ]);
      setState((prev) => ({ catalog, registryCatalog: prev.registryCatalog, instances, registries, loading: false, error: null }));
    } catch (error) {
      setState({ catalog: [], registryCatalog: [], instances: [], registries: [], loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const searchParamsKey = searchParams.toString();
  const trackedSearchParamsKeyRef = useRef(searchParamsKey);
  useEffect(() => {
    if (trackedSearchParamsKeyRef.current === searchParamsKey) return;
    trackedSearchParamsKeyRef.current = searchParamsKey;
    setRegistrySource(searchParams.get(CONNECTOR_REGISTRY_PROVIDER_PARAM)?.trim() || DEFAULT_CONNECTOR_REGISTRY_SOURCE);
  }, [searchParams, searchParamsKey]);

  const registrySources = useMemo(() => state.registries.map((registry) => registry.id), [state.registries]);

  useEffect(() => {
    if (registrySources.length === 0) return;
    if (registrySources.includes(registrySource)) return;
    const fallback = registrySources.includes(DEFAULT_CONNECTOR_REGISTRY_SOURCE)
      ? DEFAULT_CONNECTOR_REGISTRY_SOURCE
      : registrySources[0];
    if (fallback) setRegistrySource(fallback);
  }, [registrySource, registrySources]);

  useEffect(() => {
    if (!registrySource || registrySource === searchParams.get(CONNECTOR_REGISTRY_PROVIDER_PARAM)) return;
    const params = new URLSearchParams(searchParams);
    params.set(CONNECTOR_REGISTRY_PROVIDER_PARAM, registrySource);
    const next = params.toString();
    trackedSearchParamsKeyRef.current = next;
    setSearchParams(params, { replace: true });
  }, [registrySource, searchParams, setSearchParams]);

  const searchRegistry = useCallback(async (options?: { browse?: boolean; page?: number; append?: boolean }) => {
    const query = searchQuery.trim();
    const browse = options?.browse ?? false;
    const page = Math.max(options?.page ?? 1, 1);
    const append = options?.append ?? false;
    if (!hasToken || (!query && !browse)) return;
    setRegistryLoading(true);
    if (!append) {
      setRegistryPage(1);
      setRegistryTotalPages(undefined);
      setState((prev) => ({ ...prev, registryCatalog: [], error: null }));
    } else {
      setState((prev) => ({ ...prev, error: null }));
    }
    try {
      const result = await searchConnectorRegistryPage(query, registrySource, { browse, page });
      setRegistryPage(page);
      setRegistryTotalPages(result.totalPages);
      setState((prev) => ({
        ...prev,
        registryCatalog: append
          ? [...prev.registryCatalog, ...result.connectors].filter((connector, index, all) => (
              all.findIndex((candidate) => candidate.id === connector.id) === index
            ))
          : result.connectors,
      }));
    } catch (searchError) {
      setState((prev) => ({ ...prev, error: searchError instanceof Error ? searchError.message : String(searchError) }));
    } finally {
      setRegistryLoading(false);
    }
  }, [hasToken, searchQuery, registrySource]);

  useEffect(() => {
    if (tab !== 'marketplace') return;
    const timeout = window.setTimeout(() => {
      if (searchQuery.trim()) {
        void searchRegistry();
      } else if (registrySource) {
        void searchRegistry({ browse: true });
      }
    }, searchQuery.trim() ? 350 : 0);
    return () => window.clearTimeout(timeout);
  }, [registrySource, searchQuery, searchRegistry, state.loading, tab]);

  const installedIds = useMemo(() => new Set(state.instances.map((instance) => instance.connectorId)), [state.instances]);
  const managedServerIds = useMemo(
    () => new Set(state.instances.flatMap((instance) => instance.materialized.type === 'mcp' ? [instance.materialized.serverId] : [])),
    [state.instances],
  );

  const removeCustomServer = useCallback(
    async (row: McpServerRow) => {
      if (!mcpSettings || config === undefined) return;
      const nextServers = customServers.filter((server) => server.clientKey !== row.clientKey);
      await patchMcpSettings(
        { sessionIdleTtlMinutes: mcpSettings.sessionIdleTtlMinutes, servers: nextServers },
        extractManagedMcpServers(config),
      );
      await mutateConfig();
      await load();
    },
    [config, customServers, load, mcpSettings, mutateConfig],
  );

  const openAddCustomServer = useCallback(() => {
    setCustomDialog({
      mode: 'add',
      row: buildNewCustomServerRow(customServers, managedServerIds),
    });
  }, [customServers, managedServerIds]);

  const saveTtl = useCallback(async () => {
    if (!mcpSettings || config === undefined || ttlSaving) return;
    setTtlSaving(true);
    setTtlSaved(false);
    try {
      await patchMcpSettings(
        { sessionIdleTtlMinutes, servers: customServers },
        extractManagedMcpServers(config),
      );
      await mutateConfig();
      setTtlSaved(true);
      showToast({ type: 'success', title: mcp.saved });
    } finally {
      setTtlSaving(false);
    }
  }, [config, customServers, mcpSettings, mutateConfig, sessionIdleTtlMinutes, ttlSaving]);

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const headerEnd = useMemo(
    () => (
      <ConnectorsPageHeaderEnd
        loading={state.loading || registryLoading}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onReloadClick={load}
        onAddCustomServer={openAddCustomServer}
        searchPlaceholder={
          tab === 'marketplace'
            ? cs.marketplaceSearchPlaceholder
            : tab === 'builtin'
              ? cs.builtinSearchPlaceholder
              : tab === 'user'
                ? cs.userSearchPlaceholder
                : cs.configSearchPlaceholder
        }
        addLabel={cs.addCustomServer}
        reloadLabel={cs.reload}
      />
    ),
    [cs, load, openAddCustomServer, registryLoading, searchQuery, state.loading, tab],
  );

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

  const installedCount = state.instances.length + customServers.length;
  const builtinCatalog = useMemo(
    () => filterAndSortConnectors(state.catalog.filter((connector) => connector.source === 'builtin'), searchQuery, connectorSort),
    [connectorSort, searchQuery, state.catalog],
  );
  const marketplaceCatalog = useMemo(
    () => filterAndSortConnectors(state.registryCatalog, searchQuery, connectorSort),
    [connectorSort, searchQuery, state.registryCatalog],
  );
  const registryCanLoadMore = tab === 'marketplace' && Boolean(registryTotalPages && registryPage < registryTotalPages);
  const visibleInstances = useMemo(
    () => state.instances.filter((instance) => installedConnectorMatchesQuery(instance, searchQuery)),
    [searchQuery, state.instances],
  );
  const visibleCustomServers = useMemo(
    () => customServers.filter((row) => customServerMatchesQuery(row, searchQuery)),
    [customServers, searchQuery],
  );
  const visibleInstalledCount = visibleInstances.length + visibleCustomServers.length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6 sm:px-8">
      {!hasToken ? (
        <p className="rounded-xl border border-edge bg-surface-panel px-4 py-3 text-sm text-fg-muted">
          {cs.tokenHint}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
          <div className="flex flex-wrap gap-x-1 gap-y-1" role="tablist" aria-label={cs.navAria}>
            {(['marketplace', 'builtin', 'user', 'config'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={cn(
                  'relative max-w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors sm:text-center',
                  tab === item
                    ? 'text-fg after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:rounded-full after:bg-accent'
                    : 'text-fg-muted hover:text-fg',
                )}
                onClick={() => setTab(item)}
              >
                {item === 'marketplace' ? cs.tabMarketplace : item === 'builtin' ? cs.tabBuiltin : item === 'user' ? cs.tabUser : cs.tabConfig}
                {item === 'builtin' ? <span className="ml-1 tabular-nums text-fg-muted">({builtinCatalog.length})</span> : null}
                {item === 'user' ? <span className="ml-1 tabular-nums text-fg-muted">({installedCount})</span> : null}
              </button>
            ))}
          </div>
          <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-2 sm:justify-end">
            {tab === 'marketplace' ? (
              <div className="inline-flex h-9 max-w-full shrink-0 overflow-x-auto rounded-lg border border-edge bg-surface-panel p-0.5 shadow-surface" role="group" aria-label={cs.registrySourceAria}>
                {state.registries.map((registry) => (
                  <button
                    key={registry.id}
                    type="button"
                    className={cn(
                      'shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                      interaction.focusRingPanel,
                      registrySource === registry.id
                        ? 'bg-fg text-surface-panel dark:bg-fg dark:text-surface-base'
                        : 'text-fg-muted hover:text-fg',
                    )}
                    aria-pressed={registrySource === registry.id}
                    onClick={() => setRegistrySource(registry.id)}
                  >
                    {registry.displayName}
                  </button>
                ))}
              </div>
            ) : null}
            {tab !== 'user' && tab !== 'config' ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-9 min-h-9 min-w-[9rem] shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
                      interaction.transition,
                      interaction.focusRingPanel,
                    )}
                  >
                    <Funnel className="size-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
                    <span>{connectorSort === 'name' ? cs.sortName : cs.sortSource}</span>
                    <ChevronDown className="size-3.5 text-fg-subtle" strokeWidth={1.75} aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="z-50 min-w-[10rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
                    sideOffset={6}
                    align="end"
                  >
                    <DropdownMenu.Item
                      className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                      onSelect={() => setConnectorSort('name')}
                    >
                      {cs.sortName}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                      onSelect={() => setConnectorSort('source')}
                    >
                      {cs.sortSource}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : null}
          </div>
        </div>

      {state.error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{state.error}</p> : null}

        {tab === 'user' && hasToken ? (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-semibold text-fg">{cs.installedTitle}</h2>
            <p className="mt-1 text-sm text-fg-muted">{cs.installedHint}</p>
          </div>

          {state.loading ? (
            <div className="grid gap-3" aria-busy="true" aria-label={cs.loading}>
              {CONNECTOR_SKELETON_KEYS.slice(0, 3).map((key) => (
                <InstalledConnectorRowSkeleton key={key} />
              ))}
            </div>
          ) : installedCount === 0 || visibleInstalledCount === 0 ? (
            <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">
              {installedCount === 0 ? cs.installedEmpty : cs.userEmpty}
            </div>
          ) : (
            <div className="grid gap-3">
              {visibleInstances.map((instance) => (
                <InstalledConnectorRow key={instance.instanceId} instance={instance} onChanged={load} t={cs} mcp={mcp} />
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

        {tab === 'config' && hasToken ? (
          <div className="flex flex-col gap-4">
            <SettingsFormSection>
              <SettingsFormSectionHeader icon={Plug} title={mcp.globalTitle} subtitle={mcp.globalHint} />
              <div className="max-w-xl">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">{mcp.idleTtlLabel}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className={cn(inputClass, 'w-40 flex-none')}
                      value={sessionIdleTtlMinutes ?? ''}
                      placeholder={mcp.idleTtlPlaceholder}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        setSessionIdleTtlMinutes(raw === '' ? undefined : Number.parseInt(raw, 10));
                        setTtlSaved(false);
                      }}
                    />
                    <Button variant="secondary" disabled={ttlSaving} onClick={() => void saveTtl()}>
                      {ttlSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                      {mcp.save}
                    </Button>
                  </div>
                  <span className="text-xs text-fg-subtle">{mcp.idleTtlHint}</span>
                </label>
              </div>
            </SettingsFormSection>
          </div>
        ) : null}

        {tab === 'marketplace' && hasToken ? (
          <div className="flex flex-col gap-4">
            {registryLoading && marketplaceCatalog.length === 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={cs.loading}>
                {CONNECTOR_SKELETON_KEYS.map((key) => (
                  <ConnectorCardSkeleton key={key} />
                ))}
              </div>
            ) : searchQuery.trim() && marketplaceCatalog.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">
                {cs.marketplaceEmpty}
              </div>
            ) : !searchQuery.trim() && marketplaceCatalog.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">
                {cs.marketplaceStartHint}
              </div>
            ) : (
              <div className="relative">
                {registryLoading ? (
                  <div className="pointer-events-none absolute inset-0 z-[1] flex justify-center bg-surface-panel/40 pt-[min(28vh,7.5rem)] backdrop-blur-[1px] motion-reduce:backdrop-blur-none dark:bg-surface-base/35" aria-busy="true" aria-label={cs.loading}>
                    <Loader2 className="size-8 shrink-0 animate-spin text-accent motion-reduce:animate-none" strokeWidth={2} aria-hidden />
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {marketplaceCatalog.map((connector) => (
                    <ConnectorCard
                      key={connector.id}
                      connector={connector}
                      installed={installedIds.has(connector.id) || connectorIsInstalled(connector, state.instances)}
                      onInstall={(selected) => setInstallDraft(buildInitialDraft(selected))}
                      t={cs}
                    />
                  ))}
                </div>
                {registryCanLoadMore ? (
                  <div className="mt-4 flex justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={registryLoading}
                      onClick={() => void searchRegistry({ browse: !searchQuery.trim(), page: registryPage + 1, append: true })}
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

        {tab === 'builtin' && hasToken ? (
          <div className="flex flex-col gap-4">
            {state.loading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={cs.loading}>
                {CONNECTOR_SKELETON_KEYS.map((key) => (
                  <ConnectorCardSkeleton key={key} />
                ))}
              </div>
            ) : builtinCatalog.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">
                {cs.builtinEmpty}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {builtinCatalog.map((connector) => (
                  <ConnectorCard
                    key={connector.id}
                    connector={connector}
                    installed={installedIds.has(connector.id) || connectorIsInstalled(connector, state.instances)}
                    onInstall={(selected) => setInstallDraft(buildInitialDraft(selected))}
                    t={cs}
                  />
                ))}
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
          onInstalled={async () => {
            await load();
            await mutateConfig();
            setTab('user');
          }}
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
            setTab('user');
          }}
        />
      ) : null}
      </div>
    </div>
  );
}
