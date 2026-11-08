import { useId } from 'react';

import type { ProviderRowModel } from '@/features/settings/providers-api';
import { activeSourceLabel } from '@/features/settings/providers/providers-settings-lib';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';

export type ProviderAuthMethod = 'api-key' | 'oauth';

/** Selects credential configuration fields; runtime credential priority remains authoritative. */
export function ProviderAuthMethodPicker({ value, onChange, language, disabled = false }: {
  value: ProviderAuthMethod; onChange: (value: ProviderAuthMethod) => void;
  language: StoredLanguage; disabled?: boolean;
}) {
  const zh = language === 'zh';
  const groupName = useId();
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="mb-2 text-sm font-medium text-fg">{zh ? '配置接入方式' : 'Configure access method'}</legend>
    <div className="grid grid-cols-2 gap-2">
      {(['api-key', 'oauth'] as const).map(method => <label key={method} className={cn(
        'relative flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm text-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
        value === method ? 'border-accent bg-surface-active' : 'border-edge bg-surface-panel',
        disabled && 'cursor-default opacity-60',
      )}>
        <input className="sr-only" type="radio" name={groupName} value={method} checked={value === method} onChange={() => onChange(method)} />
        {method === 'api-key' ? 'API Key' : zh ? '账号登录（OAuth）' : 'Account (OAuth)'}
      </label>)}
    </div>
    <p className="text-xs leading-relaxed text-fg-muted">{zh ? '选择要配置的方式；保存密钥或完成授权后，按凭据优先级生效。已保存的 API Key 优先于 OAuth。' : 'Choose which credentials to configure. Saved API keys take priority over OAuth; selecting a form does not switch the active connection.'}</p>
  </fieldset>;
}

export function ProviderConnectionStatus({ row, language }: { row?: ProviderRowModel; language: StoredLanguage }) {
  const zh = language === 'zh';
  const source = row?.authMode ?? row?.activeKeySource;
  const status = row?.authStatus;
  const connected = status === 'connected';
  return <div role="status" className="space-y-1 rounded-lg border border-edge-subtle bg-surface-panel/60 p-3">
    <p className="text-sm font-medium text-fg">{status === 'expired' ? (zh ? '授权已过期' : 'Authorization expired') : connected ? (zh ? '凭据已配置' : 'Credentials configured') : (zh ? '未连接' : 'Not connected')}</p>
    {source && source !== 'none' ? <p className="text-xs text-fg-muted">{zh ? '当前认证来源：' : 'Current credential source: '}{activeSourceLabel(messages(language).providersSettings, source)}</p> : null}
    {source === 'env' ? <p className="text-xs text-fg-muted">{zh ? '正在使用环境变量中的凭据，无需重复填写。' : 'Using credentials from the environment. No need to enter them again.'}</p> : null}
    {connected ? <p className="text-xs text-fg-muted">{zh ? '凭据状态不代表模型调用已验证。' : 'Credential status does not verify model access.'}</p> : null}
  </div>;
}
