import { ChevronRight, Plug } from 'lucide-react';

import { CapabilityIcon } from '@/features/capabilities/capability-icon';
import type { ExtensionApiRow } from '@/features/extensions/types';

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

  return <button type="button" onClick={onOpen}
    className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
    <CapabilityIcon iconUrl={extension.branding?.iconUrl} fallback={Plug} />
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-fg">{title}</span>
      <span className="mt-1 block text-xs text-fg-muted">{t('由插件提供', 'Provided by plugin')} · {extension.name}</span>
    </span>
    <span className={`shrink-0 text-xs ${needsAuthorization && !disabled ? 'text-amber-700 dark:text-amber-300' : 'text-fg-muted'}`}>{status}</span>
    <span className="shrink-0 text-xs text-accent">{action}</span>
    <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />
  </button>;
}
