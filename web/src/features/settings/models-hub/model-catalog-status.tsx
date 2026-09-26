import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, CircleDashed, Loader2, RefreshCw, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { cn } from '@/lib/cn';
import { isComputerUseAvailable } from '@/lib/electron-env';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { capabilitySettingsPath } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import {
  CAPABILITY_READINESS_SWR_KEY,
  MODEL_CATALOG_SWR_KEY,
  revalidateModelsHubCaches,
} from './models-hub-cache';
import {
  deriveCapabilityDisplayStatus,
  type CapabilityId,
  type CapabilityReadinessPayload,
} from './capability-display-status';

interface CatalogPayload {
  sources: Record<string, {
    lastSuccessAt: number;
    models: Array<{ availability: 'available' | 'unavailable' }>;
  }>;
  sync: {
    refreshing: boolean;
    lastAttemptAt?: number;
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

function referenceLocation(location: string, zh: boolean): { label: string; href: string } {
  if (location.startsWith('agentCatalog.defaults.models')) {
    return {
      label: zh ? '全局智能体默认模型' : 'Global agent defaults',
      href: '/settings/agent-defaults',
    };
  }
  const agentMatch = location.match(/^agentCatalog\.agents\.([^.]+)\.models/);
  if (agentMatch?.[1]) {
    return {
      label: zh ? `智能体 ${agentMatch[1]}` : `Agent ${agentMatch[1]}`,
      href: agentsAppDetailPath(agentMatch[1]),
    };
  }
  if (location.startsWith('sessions.')) {
    return {
      label: zh ? '会话模型覆盖' : 'Session model override',
      href: '/settings/sessions',
    };
  }
  return {
    label: location,
    href: '/settings/agent-defaults',
  };
}

function capabilityAction(capability: CapabilityId, zh: boolean) {
  switch (capability) {
    case 'computer-use':
      return {
        href: '/settings/computer-use',
        guidance: zh ? '选择兼容的电脑控制模型；本机权限需单独授权' : 'Select a compatible computer model; local access requires separate approval',
        action: zh ? '配置电脑控制' : 'Configure computer use',
      };
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
        guidance: zh ? '选择语音识别服务，或安装自管 STT 扩展' : 'Choose a speech-to-text service or install a self-managed STT extension',
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

function capabilitySettingsHref(capability: CapabilityId): string {
  switch (capability) {
    case 'computer-use':
      return '/settings/computer-use';
    case 'vision':
      return capabilitySettingsPath('models');
    case 'image-generation':
      return capabilitySettingsPath('image');
    case 'stt':
    case 'tts':
      return capabilitySettingsPath('voice');
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
    revalidateOnFocus: true,
    refreshInterval: 60_000,
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
  const loadFailed = Boolean(error);
  const sourceErrors = data?.sync.sourceErrors ?? {};
  const diagnosticErrors = [
    ...(data?.sync.lastError ? [['catalog', data.sync.lastError] as const] : []),
    ...Object.entries(sourceErrors),
    ...(actionError ? [['refresh', actionError] as const] : []),
    ...(error instanceof Error ? [['load', error.message] as const] : []),
  ];
  const lastCheckedAt = data?.sync.lastAttemptAt ?? lastSuccessAt;
  const capabilityEntries = (Object.entries(readiness?.capabilities ?? {}) as Array<[
    CapabilityId,
    CapabilityReadinessPayload['capabilities'][CapabilityId],
  ]>).filter(([capability]) => capability !== 'computer-use' || isComputerUseAvailable());
  const capabilityNeedsAttention = capabilityEntries.some(([, plan]) => {
    const status = deriveCapabilityDisplayStatus(plan);
    return status === 'degraded' || status === 'misconfigured';
  });
  const readyCount = capabilityEntries.filter(([, plan]) => deriveCapabilityDisplayStatus(plan) === 'ready').length;

  const refresh = async () => {
    setRefreshing(true);
    setActionError(null);
    try {
      const response = await apiFetch(apiUrl('/api/models/catalog/refresh'), { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await revalidateModelsHubCaches();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="rounded-xl bg-surface-hover/25 p-4 sm:p-5">
      <details className="group" open={capabilityNeedsAttention || undefined}>
        <summary className="cursor-pointer list-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <div className="flex min-h-10 items-center gap-2">
            {capabilityNeedsAttention ? (
              <AlertTriangle className="size-4 text-amber-500" aria-hidden />
            ) : readyCount === capabilityEntries.length && capabilityEntries.length > 0 ? (
              <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
            ) : (
              <CircleDashed className="size-4 text-fg-muted" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-fg">{zh ? '可选能力' : 'Optional capabilities'}</span>
              <span className="mt-0.5 block text-xs font-normal text-fg-muted">
                {zh
                  ? `${readyCount}/${capabilityEntries.length} 项已配置，不影响基础聊天功能`
                  : `${readyCount} of ${capabilityEntries.length} configured · Not required for chat`}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
          </div>
        </summary>
        {readiness ? (
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            {(Object.entries(readiness.capabilities) as Array<[
              CapabilityId,
              CapabilityReadinessPayload['capabilities'][CapabilityId],
            ]>).map(([capability, plan]) => {
              if (capability === 'computer-use' && !isComputerUseAvailable()) return null;
              const label = capability === 'vision'
                ? (zh ? '图片理解' : 'Vision')
                : capability === 'image-generation'
                  ? (zh ? '图片生成' : 'Image generation')
                  : capability === 'computer-use' ? (zh ? '电脑控制模型' : 'Computer use model') : capability.toUpperCase();
              const automatic = plan.selectionSource !== 'explicit-config';
              const displayStatus = deriveCapabilityDisplayStatus(plan);
              const needsAttention = displayStatus === 'degraded' || displayStatus === 'misconfigured';
              const action = capabilityAction(capability, zh);
              const content = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-xs font-medium text-fg">{label}</span>
                    <span className={displayStatus === 'ready'
                      ? 'shrink-0 text-xs text-emerald-600 dark:text-emerald-400'
                      : displayStatus === 'off' || displayStatus === 'not-configured'
                        ? 'shrink-0 text-xs text-fg-muted'
                        : 'shrink-0 text-xs text-amber-600 dark:text-amber-400'}>
                      {displayStatus === 'ready'
                        ? capability === 'computer-use' ? (zh ? '已配置' : 'Configured') : (zh ? '可用' : 'Ready')
                        : displayStatus === 'off'
                          ? (zh ? '已关闭' : 'Off')
                          : displayStatus === 'not-configured'
                            ? (zh ? '未配置' : 'Not configured')
                            : displayStatus === 'degraded'
                              ? (zh ? '正在使用备用方案' : 'Using fallback')
                              : (zh ? '需处理' : 'Needs attention')}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-fg-muted" title={plan.primary
                    ? `${plan.primary.provider}/${plan.primary.model}`
                    : undefined}>
                    {plan.primary
                      ? `${automatic ? (zh ? '自动' : 'Auto') : (zh ? '显式' : 'Explicit')} · ${plan.primary.provider}/${plan.primary.model}`
                      : displayStatus === 'not-configured'
                        ? (zh ? '可稍后按需配置' : 'Set up later if needed')
                        : (zh ? '已配置的模型不可用' : 'The configured model is unavailable')}
                  </p>
                  {needsAttention ? (
                    <div className="mt-2 rounded-lg bg-amber-500/10 p-2">
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

              return (
                <Link
                  key={capability}
                  to={needsAttention ? action.href : capabilitySettingsHref(capability)}
                  aria-label={needsAttention ? `${label}：${action.action}` : `${zh ? '配置' : 'Configure'} ${label}`}
                  className={cn(
                    'rounded-lg bg-surface-base/45 px-3 py-3 transition-colors',
                    needsAttention ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-surface-hover/30',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        ) : null}
      </details>
      {unavailable.length > 0 ? (
        <div className="mt-3 space-y-2" aria-live="polite">
          {unavailable.map((reference) => (
            <div key={reference.ref} className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
              {(() => {
                const providerId = reference.ref.split('/')[0] ?? '';
                const temporarilyUnverified = Boolean(sourceErrors[providerId]);
                const repairLocation = referenceLocation(reference.locations[0] ?? '', zh);
                return (
                  <>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium text-fg">
                          {reference.ref}
                          <span className="ml-2 font-normal text-amber-700 dark:text-amber-300">
                            {temporarilyUnverified
                              ? (zh ? '暂时无法验证' : 'Temporarily unverified')
                              : (zh ? '不可用' : 'Unavailable')}
                          </span>
                        </p>
                        <p className="mt-1 text-xs leading-5 text-fg-muted">
                          {temporarilyUnverified
                            ? (zh ? '模型目录同步暂时失败，当前状态可能已过期；不会影响其他可用模型。' : 'Catalog sync temporarily failed, so this status may be stale. Other available models are unaffected.')
                            : (zh ? '此模型已无法从当前配置中解析，使用它的功能可能失败。' : 'This model no longer resolves from the current configuration. Features using it may fail.')}
                          {lastCheckedAt ? ` · ${zh ? '最近检测' : 'Last checked'} ${new Date(lastCheckedAt).toLocaleString()}` : ''}
                        </p>
                        {reference.suggestedRef ? (
                          <p className="mt-1 text-xs text-fg-muted">
                            {zh ? '可替换为' : 'Suggested replacement'}：<span className="font-medium text-fg">{reference.suggestedRef}</span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Button className="px-2.5 py-1.5 text-xs" variant="ghost" disabled={refreshing} onClick={() => void refresh()}>
                        {refreshing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                        {refreshing ? (zh ? '检测中…' : 'Checking…') : (zh ? '重新检测' : 'Check again')}
                      </Button>
                      <Button asChild className="px-2.5 py-1.5 text-xs" variant="ghost">
                        <Link to={repairLocation.href}>
                          <Wrench className="size-3.5" aria-hidden />
                          {reference.suggestedRef ? (zh ? '更换模型' : 'Replace model') : (zh ? '调整配置' : 'Adjust configuration')}
                        </Link>
                      </Button>
                      <details className="group/references">
                        <summary className="touch-target inline-flex cursor-pointer list-none items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                          {zh ? `查看 ${reference.locations.length} 处引用` : `View ${reference.locations.length} ${reference.locations.length === 1 ? 'reference' : 'references'}`}
                          <ChevronRight className="size-3.5 transition-transform group-open/references:rotate-90 motion-reduce:transition-none" aria-hidden />
                        </summary>
                        <ul className="mt-1 space-y-1 pl-2 text-xs text-fg-muted">
                          {reference.locations.map((location) => {
                            const target = referenceLocation(location, zh);
                            return (
                              <li key={location}>
                                <Link className="inline-flex rounded px-1.5 py-1 text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" to={target.href} title={location}>
                                  {target.label}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      ) : null}
      {loadFailed || actionError ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {loadFailed
            ? (zh ? '暂时无法读取模型状态，请重新检测；详细信息可在高级诊断中查看。' : 'Model status is temporarily unavailable. Check again; details are available in Advanced diagnostics.')
            : (zh ? '重新检测失败，请稍后重试；详细信息可在高级诊断中查看。' : 'The check failed. Try again later; details are available in Advanced diagnostics.')}
        </p>
      ) : null}
      <details className="mt-4 border-t border-edge-subtle pt-3">
        <summary className="min-h-8 cursor-pointer rounded-md py-1.5 text-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {zh ? '高级诊断' : 'Advanced diagnostics'}
        </summary>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-fg-muted">
            <p>
              {zh
                ? `${sources.length} 个来源，${availableCount} 个可用模型${lastSuccessAt ? ` · 最近同步 ${new Date(lastSuccessAt).toLocaleString()}` : ''}`
                : `${sources.length} sources, ${availableCount} available models${lastSuccessAt ? ` · Last synced ${new Date(lastSuccessAt).toLocaleString()}` : ''}`}
            </p>
            {diagnosticErrors.length > 0 ? (
              <div className="mt-2 space-y-1 rounded-lg bg-surface-base/45 p-2 font-mono text-[11px] leading-5" aria-label={zh ? '同步错误详情' : 'Sync error details'}>
                {diagnosticErrors.map(([source, message], index) => (
                  <p className="break-words" key={`${source}-${index}`}>{source}: {message}</p>
                ))}
              </div>
            ) : null}
          </div>
          <Button className="shrink-0" type="button" variant="secondary" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {refreshing ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新目录' : 'Refresh catalog')}
          </Button>
        </div>
      </details>
    </section>
  );
}
