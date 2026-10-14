import { useId, useState } from 'react';
import type { ConnectionNeedView } from '@xopcai/gateway-contract';

export function ConnectionAccountPrompt({ need, language, disabled, onSelect, onConnect }: {
  need: ConnectionNeedView;
  language: 'zh' | 'en';
  disabled: boolean;
  onSelect: (accountId: string) => void;
  onConnect: () => void;
}) {
  const groupId = useId();
  const [selected, setSelected] = useState<string>();
  const zh = language === 'zh';
  const valid = need.accounts.some(account => account.id === selected);
  return <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-3 border-t border-edge-subtle pt-3">
    <legend className="float-left mb-3 w-full text-sm font-medium text-fg">
      {zh ? `这次使用哪个 ${need.label} 账号或工作区？` : `Which ${need.label} account or workspace should this request use?`}
    </legend>
    <div className="clear-both grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
      {need.accounts.map(account => <label key={account.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm text-fg hover:bg-surface-hover ${selected === account.id ? 'border-accent bg-surface-hover' : 'border-edge'}`}>
        <input type="radio" name={groupId} value={account.id} checked={selected === account.id}
          onChange={() => setSelected(account.id)} className="shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
        <span className="min-w-0 break-words">{account.label}</span>
      </label>)}
    </div>
    <p className="text-xs text-fg-muted">{zh ? '选择仅用于本次目标，选定后会自动继续。' : 'This choice applies to this objective only. It will continue after selection.'}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled || !valid} onClick={() => { if (valid && selected) onSelect(selected); }}
        className="min-h-11 rounded-lg bg-accent px-3 py-2 text-sm text-on-accent disabled:opacity-50">
        {zh ? '使用所选账号并继续' : 'Use selected account and continue'}
      </button>
      <button type="button" disabled={disabled} onClick={onConnect}
        className="min-h-11 rounded-lg px-3 py-2 text-sm text-accent hover:bg-surface-hover disabled:opacity-50">
        {zh ? '连接其他账号' : 'Connect another account'}
      </button>
    </div>
  </fieldset>;
}
