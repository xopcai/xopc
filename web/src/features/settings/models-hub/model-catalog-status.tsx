import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { capabilitySettingsPath } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import {
  CAPABILITY_READINESS_SWR_KEY,
  MODEL_CATALOG_SWR_KEY,
  revalidateModelsHubCaches,
} from './models-hub-cache';

interface CatalogPayload {
  sources: Record<string, {
    lastSuccessAt: number;
    models: Array<{ availability: 'available' | 'unavailable' }>;
  }>;
  sync: {
    refreshing: boolean;
    lastSuccessAt?: number;
    lastError?: string;
    sourceErrors?: Record<string, string>;
  };
  references: Array<{
    ref: string;
    availability: 'available' | 'unavailable';
    locations: string[];
    suggestedRef?: string;
  }>;
}

type CapabilityId = 'vision' | 'image-generation' | 'stt' | 'tts';

interface CapabilityReadinessPayload {
  capabilities: Record<CapabilityId, {
    status: 'ready' | 'degraded' | 'unavailable' | 'disabled';
    selectionSource: string;
    primary?: { provider: string; model: string };
  }>;
}

function capabilityAction(capability: CapabilityId, zh: boolean) {
  switch (capability) {
    case 'vision':
      return {
        href: `${capabilitySettingsPath('models')}?add=1`,
        guidance: zh ? '接入支持图片理解的模型服务' : 'Connect a model service that supports vision',
        action: zh ? '去接入模型' : 'Connect model',
      };
    case 'image-generation':
      return {
        href: capabilitySettingsPath('image'),
        guidance: zh ? '选择图片模型并配置所需凭据' : 'Choose an image model and configure its credentials',
        action: zh ? '去配置图片生成' : 'Configure image generation',
      };
    case 'stt':
      return {
        href: capabilitySettingsPath('voice'),
        guidance: zh ? '选择语音识别服务，或安装本地语音模型' : 'Choose a speech-to-text service or install a local voice model',
        action: zh ? '去配置语音识别' : 'Configure speech-to-text',
      };
    case 'tts':
      return {
        href: capabilitySettingsPath('voice'),
        guidance: zh ? '选择语音合成服务并完成凭据配置' : 'Choose a text-to-speech service and configure its credentials',
        action: zh ? '去配置语音合成' : 'Configure text-to-speech',
      };
  }
}

async function fetchCatalog(): Promise<CatalogPayload> {
  const response = await apiFetch(apiUrl('/api/models/catalog'));
  const body = await response.json().catch(() => null) as {
    ok?: boolean;
    payload?: CatalogPayload;
    error?: { message?: string };
  } | null;
  if (!response.ok || !body?.ok || !body.payload) {
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return body.payload;
}

async function fetchCapabilityReadiness(): Promise<CapabilityReadinessPayload> {
  const response = await apiFetch(apiUrl('/api/capabilities/readiness'));
  const body = await response.json().catch(() => null) as {
    ok?: boolean;
    payload?: CapabilityReadinessPayload;
    error?: { message?: string };
  } | null;
  if (!response.ok || !body?.ok || !body.payload) {
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return body.payload;
}

export function ModelCatalogStatus() {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const { data, error, isLoading } = useSWR(MODEL_CATALOG_SWR_KEY, fetchCatalog, {
    revalidateOnFocus: false,
  });
  const { data: readiness } = useSWR(
    CAPABILITY_READINESS_SWR_KEY,
    fetchCapabilityReadiness,
    { revalidateOnFocus: false },
  );
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-2xl" />;
  }

  const sources = Object.values(data?.sources ?? {});
  const availableCount = sources.reduce(
    (sum, source) => sum + source.models.filter((model) => model.availability === 'available').length,
    0,
  );
  const unavailable = (data?.references ?? []).filter((reference) => reference.availability === 'unavailable');
  const lastSuccessAt = data?.sync.lastSuccessAt ?? Math.max(0, ...sources.map((source) => source.lastSuccessAt));
  const failure = actionError ?? (error instanceof Error
    ? error.message
    : data?.sync.lastError ?? Object.values(data?.sync.sourceErrors ?? {})[0]);
  const capabilityNeedsAttention = Object.values(readiness?.capabilities ?? {}).some(
    (plan) => plan.status === 'degraded' || plan.status === 'unavailable',
  );

  const refresh = async () => {
    setRefreshing(true);
    setActionError(null);
    try {
      const response = await apiFetch(apiUrl('/api/models/catalog/refresh'), { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await revalidateModelsHubCaches();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : (zh ? '模型目录刷新失败' : 'Model catalog refresh failed'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-edge-subtle bg-surface-panel/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {failure || unavailable.length > 0 || capabilityNeedsAttention ? (
              <AlertTriangle className="size-4 text-amber-500" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
            )}
            <h2 className="text-sm font-semibold text-fg">{zh ? '模型目录同步' : 'Model catalog sync'}</h2>
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {zh
              ? `${sources.length} 个来源，${availableCount} 个可用模型${lastSuccessAt ? ` · 最近同步 ${new Date(lastSuccessAt).toLocaleString()}` : ''}`
              : `${sources.length} sources, ${availableCount} available models${lastSuccessAt ? ` · Last synced ${new Date(lastSuccessAt).toLocaleString()}` : ''}`}
          </p>
        </div>
        <Button className="shrink-0" type="button" variant="secondary" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          {refreshing ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '立即刷新' : 'Refresh now')}
        </Button>
      </div>
      {readiness ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.entries(readiness.capabilities) as Array<[
            CapabilityId,
            CapabilityReadinessPayload['capabilities'][CapabilityId],
          ]>).map(([capability, plan]) => {
            const label = capability === 'vision'
              ? (zh ? '图片理解' : 'Vision')
              : capability === 'image-generation'
                ? (zh ? '图片生成' : 'Image generation')
                : capability.toUpperCase();
            const automatic = plan.selectionSource !== 'explicit-config';
            const needsAttention = plan.status === 'degraded' || plan.status === 'unavailable';
            const action = capabilityAction(capability, zh);
            const content = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-xs font-medium text-fg">{label}</span>
                  <span className={plan.status === 'ready'
                    ? 'shrink-0 text-xs text-emerald-600 dark:text-emerald-400'
                    : plan.status === 'disabled'
                      ? 'shrink-0 text-xs text-fg-muted'
                      : 'shrink-0 text-xs text-amber-600 dark:text-amber-400'}>
                    {plan.status === 'ready'
                      ? (zh ? '可用' : 'Ready')
                      : plan.status === 'disabled'
                        ? (zh ? '已关闭' : 'Off')
                        : (zh ? '需处理' : 'Needs attention')}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-fg-muted" title={plan.primary
                  ? `${plan.primary.provider}/${plan.primary.model}`
                  : undefined}>
                  {plan.primary
                    ? `${automatic ? (zh ? '自动' : 'Auto') : (zh ? '显式' : 'Explicit')} · ${plan.primary.provider}/${plan.primary.model}`
                    : (zh ? '无可用实现' : 'No available implementation')}
                </p>
                {needsAttention ? (
                  <div className="mt-2 border-t border-edge-subtle pt-2">
                    <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                      {plan.status === 'degraded'
                        ? (zh ? `当前配置不可用，正在使用备用方案。${action.guidance}` : `The current configuration is unavailable, so a fallback is in use. ${action.guidance}.`)
                        : action.guidance}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent">
                      {action.action}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </span>
                  </div>
                ) : null}
              </>
            );

            return needsAttention ? (
              <Link
                key={capability}
                to={action.href}
                aria-label={`${label}：${action.action}`}
                className={cn(
                  'rounded-xl border border-amber-400/40 bg-amber-500/5 px-3 py-2',
                  'transition-colors hover:border-amber-400/70 hover:bg-amber-500/10',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                )}
              >
                {content}
              </Link>
            ) : (
              <div key={capability} className="rounded-xl border border-edge-subtle bg-surface-panel px-3 py-2">
                {content}
              </div>
            );
          })}
        </div>
      ) : null}
      {unavailable.length > 0 ? (
        <div className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-300">
          {unavailable.slice(0, 3).map((reference) => (
            <p key={reference.ref}>
              {reference.ref} {zh ? '不可用' : 'is unavailable'}
              {reference.suggestedRef ? ` · ${zh ? '建议' : 'Suggested'} ${reference.suggestedRef}` : ''}
              {` · ${reference.locations.length} ${zh ? '处引用' : 'references'}`}
            </p>
          ))}
        </div>
      ) : null}
      {failure ? <p className="mt-2 text-sm text-danger">{failure}</p> : null}
    </div>
  );
}
