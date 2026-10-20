import { Cable, ChevronDown, ChevronUp, Loader2, Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchConnectorInstances, fetchStoreConnectorInstallPlan } from '@/features/connectors/connectors-api';
import { buildInitialDraft, type InstallDraft } from '@/features/connectors/components/install-connector-draft';
import { InstallConnectorDialog } from '@/features/connectors/components/install-connector-dialog';
import { AgentPluginDialog } from '@/features/extensions/agent-plugin-dialog';
import type { ExtensionApiRow, ExtensionsListResponse } from '@/features/extensions/types';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

import { filterCapabilityCatalog, type CapabilityCatalogItem } from './capability-catalog';
import { CapabilityIcon } from './capability-icon';
import { fetchServiceRecommendations } from './service-recommendation-api';

export function ServiceRecommendationList({ initialCount = 3, query = '', layout = 'list', onChanged }: { initialCount?: number; query?: string; layout?: 'list' | 'cards'; onChanged?: () => void | Promise<void> }) {
  const navigate = useNavigate();
  const language = useLocaleStore(state => state.language);
  const zh = language.startsWith('zh');
  const copy = messages(language).onboarding.workDiscovery;
  const connectorCopy = messages(language).connectorsSettings;
  const { data, error, isLoading, mutate } = useSWR(['service-recommendations', language], () => fetchServiceRecommendations(language), { revalidateOnFocus: false });
  const { data: instances, error: instancesError, mutate: refreshInstances } = useSWR('recommended-connector-instances', fetchConnectorInstances);
  const { data: extensions, error: pluginsError, mutate: refreshPlugins } = useSWR('gateway-extensions-list', () => fetchJson<ExtensionsListResponse>(apiUrl('/api/extensions')));
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<InstallDraft | null>(null);
  const [plugin, setPlugin] = useState<{ id: string; extension?: ExtensionApiRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const items = filterCapabilityCatalog(data?.items ?? [], 'all', query, language);

  async function resourcesChanged() {
    const results = await Promise.allSettled([refreshInstances(), refreshPlugins(), Promise.resolve().then(() => onChanged?.())]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') setActionError(String(failure.reason));
  }

  async function connect(item: CapabilityCatalogItem, extension?: ExtensionApiRow) {
    setActionError('');
    if (item.service?.source === 'store-plugin') {
      setPlugin({ id: item.id, extension });
      return;
    }
    const instance = instances?.find(row => row.connectorId === item.id);
    if (instance) {
      navigate(`/capabilities/connectors?tab=connected&instance=${encodeURIComponent(instance.instanceId)}`);
      return;
    }
    setBusyId(item.id);
    try {
      if (item.service?.source === 'store-connector') {
        const plan = await fetchStoreConnectorInstallPlan(item.id);
        setDraft(buildInitialDraft(plan.definition, { packageName: plan.packageName, version: plan.version, reviewHash: plan.reviewHash, permissions: plan.permissions }));
      } else {
        const definition = data?.definitions.find(definition => definition.id === item.id);
        if (definition) setDraft(buildInitialDraft(definition));
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {isLoading ? <div className={layout === 'cards' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'} aria-busy="true">{Array.from({ length: initialCount }, (_, index) => <Skeleton key={index} className={layout === 'cards' ? 'h-[8.75rem] rounded-xl' : 'h-20 rounded-xl'} />)}</div> : null}
      {error || data?.failedSources || instancesError || pluginsError ? (
        <p className="mb-3 text-sm text-fg-muted" role="status">
          {copy.connectorLoadFailed}{' '}
          <button type="button" className="text-accent-fg hover:underline" onClick={() => { void mutate(); void refreshInstances(); void refreshPlugins(); }}>{zh ? '重试' : 'Retry'}</button>
        </p>
      ) : null}
      {!isLoading && !error && items.length === 0 ? <p className="py-6 text-center text-sm text-fg-muted">{copy.noWorkServices}</p> : null}
      <div className={layout === 'cards' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'divide-y divide-edge-subtle rounded-xl border border-edge-subtle bg-surface-base/55'}>
        {(expanded ? items : items.slice(0, initialCount)).map(item => {
          const extension = extensions?.extensions.find(row => row.format === 'agent-plugin' && row.provenance?.packageName === item.id);
          const instance = instances?.find(row => row.connectorId === item.id);
          const isPlugin = item.service?.source === 'store-plugin';
          const isConnected = isPlugin
            ? Boolean(extension?.active && extension.readiness === 'ready' && ['connected', 'not_required'].includes(extension.authorizationStatus ?? ''))
            : Boolean(instance?.enabled && instance.status === 'connected');
          const installed = isPlugin ? Boolean(extension) : Boolean(instance);
          const action = (isPlugin ? !extensions && !pluginsError : !instances && !instancesError) ? <Skeleton className="h-8 w-16 shrink-0 rounded-lg" /> : (
            <Button type="button" variant="secondary" className="h-8 shrink-0 px-3 text-xs" disabled={busyId !== null} onClick={() => void connect(item, extension)}>
              {busyId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : !installed ? <Plus className="size-3.5" /> : null}
              {isConnected ? (zh ? '管理' : 'Manage') : installed ? (zh ? '继续设置' : 'Set up') : connectorCopy.connect}
            </Button>
          );
          return (
            <article key={`${item.kind}:${item.id}`} className={cn(
              layout === 'cards'
                ? 'group flex min-h-[8.75rem] min-w-0 flex-col rounded-xl border border-edge bg-surface-panel p-4 transition-colors hover:bg-surface-hover/45 focus-within:ring-2 focus-within:ring-accent/30'
                : 'flex min-h-20 items-center gap-3 px-3 py-3 sm:px-4',
            )}>
              {layout === 'cards' ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <CapabilityIcon iconUrl={item.iconUrl} fallback={isPlugin ? Package : Cable} />
                      <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{item.name}</h3>
                    </div>
                    {action}
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-fg-muted" title={item.description}>{item.description}</p>
                </>
              ) : (
                <>
                  <CapabilityIcon iconUrl={item.iconUrl} fallback={isPlugin ? Package : Cable} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-fg">{item.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{item.description}</p>
                  </div>
                  {action}
                </>
              )}
            </article>
          );
        })}
      </div>
      {items.length > initialCount ? (
        <button type="button" className="mx-auto mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-fg hover:underline" onClick={() => setExpanded(value => !value)}>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}{expanded ? copy.showFewerServices : copy.showMoreServices}
        </button>
      ) : null}
      {actionError ? <p className="mt-3 text-xs text-danger" role="alert">{actionError}</p> : null}
      {draft ? <InstallConnectorDialog draft={draft} onChange={setDraft} onClose={() => setDraft(null)} t={connectorCopy} onInstalled={async () => { await resourcesChanged(); setDraft(null); }} /> : null}
      {plugin ? <AgentPluginDialog initialSource={`store:${plugin.id}`} extension={plugin.extension} onClose={() => { setPlugin(null); void resourcesChanged(); }} /> : null}
    </div>
  );
}
