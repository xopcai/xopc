import { AlertCircle, CheckCircle2, ChevronRight, Clock3, PauseCircle, Plug } from 'lucide-react';

import { CapabilityIcon } from '@/features/capabilities/capability-icon';
import type { ExtensionApiRow } from '@/features/extensions/types';
import { cn } from '@/lib/cn';

/** Plugin-owned accounts are managed by the plugin's declared setup flow. */
export function pluginHasConnection(extension: ExtensionApiRow): boolean {
  return extension.format === 'agent-plugin' && Boolean(extension.pluginId) && (
    Boolean(extension.setup?.authorizations?.length)
    || extension.authorizationStatus === 'required'
    || Boolean(extension.components?.mcp.some(server => server.type !== 'stdio'))
  );
}

export function InstalledPluginConnectionRow({ extension, language, onOpen }: {
  extension: ExtensionApiRow;
  language: string;
  onOpen: () => void;
}) {
  const zh = language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const preparing = extension.installationState === 'preparing';
  const disabled = extension.activationEligible === false;
  const needsAuthorization = extension.authorizationStatus === 'required';
  const status = preparing ? t('准备未完成', 'Setup incomplete') : disabled ? t('已停用', 'Disabled')
    : needsAuthorization ? t('需要授权', 'Authorization required')
      : extension.readiness === 'blocked' || extension.readiness === 'degraded' ? t('需要处理', 'Needs attention')
        : t('已连接', 'Connected');
  const action = preparing ? t('继续安装', 'Continue setup') : !disabled && needsAuthorization
    ? t('去授权', 'Connect account') : t('查看详情', 'View details');
  const accounts = extension.setup?.authorizations ?? [];
  const title = accounts.length === 1 ? accounts[0].title : extension.name;
  const needsAttention = preparing || (!disabled && (needsAuthorization || extension.readiness === 'blocked' || extension.readiness === 'degraded'));
  const StatusIcon = preparing ? Clock3 : disabled ? PauseCircle : needsAttention ? AlertCircle : CheckCircle2;

  return <button type="button" onClick={onOpen}
    className={cn('flex min-h-[8.75rem] w-full min-w-0 flex-col rounded-xl border border-edge bg-surface-panel p-4 text-left transition-colors hover:bg-surface-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', needsAttention && 'border-amber-500/25')}>
    <span className="flex w-full min-w-0 items-start gap-3">
      <CapabilityIcon iconUrl={extension.branding?.iconUrl} fallback={Plug} className="size-9" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg" title={title}>{title}</span>
        <span className={cn('mt-1 inline-flex items-center gap-1 text-[11px]', needsAttention ? 'text-amber-700 dark:text-amber-300' : disabled ? 'text-fg-muted' : 'text-emerald-700 dark:text-emerald-300')}>
          <StatusIcon className="size-3.5" aria-hidden />
          {status}
        </span>
      </span>
    </span>
    <span className="mt-2 block w-full truncate text-xs leading-5 text-fg-muted" title={extension.name}>{t('由插件提供', 'Provided by plugin')} · {extension.name}</span>
    <span className={cn('mt-auto flex w-full items-center justify-end gap-1 pt-2 text-xs', needsAttention ? 'text-accent-fg' : 'text-fg-muted')}>
      {action}
      <ChevronRight className="size-3.5 shrink-0" aria-hidden />
    </span>
  </button>;
}
