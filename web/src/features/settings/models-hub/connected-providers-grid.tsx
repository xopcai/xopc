import { CheckCircle2, Plus, Settings2 } from 'lucide-react';
import { useMemo } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/api/registry-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  mergeProviderRows,
  providersKeysFromConfigRoot,
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import { fetchModelsJson, normalizeModelsJsonConfig, type ModelsJsonConfig } from '@/features/settings/models-json-api';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

export interface ConnectedProvidersMessages {
  title: string;
  titleCount: string;
  empty: string;
  emptyHint: string;
  addProvider: string;
  manage: string;
  models: string;
  modelsCount: string;
  custom: string;
  loading: string;
  noModels: string;
}

interface ConnectedProvidersGridProps {
  labels: ConnectedProvidersMessages;
  onAdd: () => void;
  onManage: (providerId: string, isCustom: boolean) => void;
}

export interface ConnectedProviderCard {
  id: string;
  name: string;
  configured: boolean;
  isCustom: boolean;
  modelCount: number;
}

/** Fetch and merge all provider sources into a unified card list. */
export function useConnectedProviders(): {
  cards: ConnectedProviderCard[];
  loading: boolean;
  builtinRows: ProviderRowModel[];
  customConfig: ModelsJsonConfig | null;
  allModels: ConfiguredModel[];
} {
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);

  const { data: cfgData, isLoading: cfgLoading } = useGatewayConfigSwr(hasToken);
  const { data: metaList, isLoading: metaLoading } = useSWR(
    hasToken ? apiUrl('/api/providers/meta') : null,
    async (url: string) => {
      const { payload } = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
      return (payload?.providers ?? []) as import('@/features/settings/providers-api').ProviderMeta[];
    },
    { revalidateOnFocus: false },
  );
  const { data: models = [], isLoading: modelsLoading } = useSWR(
    hasToken ? CONFIGURED_MODELS_SWR_KEY : null,
    () => fetchConfiguredModelsCached(),
    { revalidateOnFocus: false },
  );
  const { data: modelsJsonData } = useSWR(
    hasToken ? 'models-json-config' : null,
    () => fetchModelsJson(),
    { revalidateOnFocus: false },
  );

  const builtinRows = useMemo((): ProviderRowModel[] => {
    if (!metaList || cfgData === undefined) return [];
    const keys = providersKeysFromConfigRoot(cfgData?.payload?.config);
    return mergeProviderRows(metaList, keys, models);
  }, [metaList, cfgData, models]);

  const customConfig = useMemo((): ModelsJsonConfig | null => {
    if (!modelsJsonData) return null;
    return normalizeModelsJsonConfig(modelsJsonData.config);
  }, [modelsJsonData]);

  const cards = useMemo((): ConnectedProviderCard[] => {
    const result: ConnectedProviderCard[] = [];

    // Built-in configured providers
    for (const row of builtinRows) {
      if (!row.configured) continue;
      const modelCount = models.filter((m) => m.provider === row.id).length;
      result.push({
        id: row.id,
        name: row.name,
        configured: true,
        isCustom: false,
        modelCount,
      });
    }

    // Custom providers from models.json
    if (customConfig) {
      for (const [providerId, providerConfig] of Object.entries(customConfig.providers)) {
        // Skip if already in built-in list
        if (result.some((c) => c.id === providerId)) continue;
        result.push({
          id: providerId,
          name: providerId,
          configured: true,
          isCustom: true,
          modelCount: providerConfig.models?.length ?? 0,
        });
      }
    }

    return result;
  }, [builtinRows, customConfig, models]);

  const loading = cfgLoading || metaLoading || modelsLoading;

  return { cards, loading, builtinRows, customConfig, allModels: models };
}

export function ConnectedProvidersGrid({ labels, onAdd, onManage }: ConnectedProvidersGridProps) {
  const { cards, loading } = useConnectedProviders();

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-6 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-hover" />
          ))}
        </div>
      </div>
    );
  }

  const configuredCards = cards.filter((c) => c.configured);

  return (
    <div className="flex flex-col gap-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">
          {configuredCards.length > 0
            ? labels.titleCount.replace('{{count}}', String(configuredCards.length))
            : labels.title}
        </h2>
        <Button type="button" variant="primary" className="gap-1.5" onClick={onAdd}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          {labels.addProvider}
        </Button>
      </div>

      {/* Empty state */}
      {configuredCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-edge-subtle bg-surface-panel/40 px-6 py-10 text-center">
          <p className="text-sm font-medium text-fg">{labels.empty}</p>
          <p className="mt-1 text-sm text-fg-muted">{labels.emptyHint}</p>
          <Button type="button" variant="primary" className="mt-4 gap-1.5" onClick={onAdd}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            {labels.addProvider}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {configuredCards.map((card) => (
            <ProviderCard
              key={card.id}
              card={card}
              labels={labels}
              onManage={() => onManage(card.id, card.isCustom)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  card,
  labels,
  onManage,
}: {
  card: ConnectedProviderCard;
  labels: ConnectedProvidersMessages;
  onManage: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onManage}
      className={cn(
        'group relative flex flex-col justify-between rounded-2xl border border-edge-subtle bg-surface-base p-4 text-left transition-colors',
        'hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        interaction.pressCard,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg">{card.name}</span>
          {card.isCustom ? (
            <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
              {labels.custom}
            </span>
          ) : null}
        </div>
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-xs text-fg-subtle">
          {card.modelCount > 0
            ? labels.modelsCount.replace('{{count}}', String(card.modelCount))
            : labels.noModels}
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-accent-fg opacity-0 transition-opacity group-hover:opacity-100">
          <Settings2 className="size-3" aria-hidden />
          {labels.manage}
        </span>
      </div>
    </button>
  );
}
