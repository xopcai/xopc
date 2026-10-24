import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { phoneRequest } from './phone-api';

export function PhoneTextInput({ deviceId, value, onChange, disabled, zh }: {
  deviceId?: string; value: 'auto' | 'manual'; onChange(value: 'auto' | 'manual'): void; disabled: boolean; zh: boolean;
}) {
  const [checking, setChecking] = useState(false); const [result, setResult] = useState('');
  async function check() {
    setChecking(true); setResult('');
    try {
      const status = await phoneRequest<{ unicode: string }>(`/devices/${deviceId}/input-status`);
      setResult(status.unicode === 'available' ? (zh ? '中文输入通道已就绪，具体应用仍需允许粘贴。' : 'Unicode input is ready. The app must allow pasting.')
        : status.unicode === 'setup_required' ? (zh ? '请在手机依赖中安装或修复 scrcpy server，再重试检测。无需安装手机输入法。' : 'Install or repair scrcpy server under phone dependencies, then retry. No phone keyboard installation is needed.')
          : (zh ? '这台手机暂不支持自动中文输入，请接管后使用手机自带键盘。' : 'Automatic Unicode input is unavailable. Take over and use the phone keyboard.'));
    } catch { setResult(zh ? '暂时无法检测，请确认手机连接后重试。' : 'Unable to check. Reconnect the phone and retry.'); }
    finally { setChecking(false); }
  }
  return <div className="space-y-2 rounded-xl border border-edge bg-surface-base p-3">
    <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-sm font-medium">{zh ? '允许自动输入文字' : 'Allow automatic text input'}<input type="checkbox" checked={value === 'auto'} disabled={disabled} onChange={event => onChange(event.target.checked ? 'auto' : 'manual')} className="size-4 accent-accent" /></label>
    <p className="text-xs leading-relaxed text-fg-muted">{value === 'auto' ? (zh ? '中文和 Emoji 通过手机剪贴板粘贴，不安装或切换输入法。输入内容可能留在手机剪贴板；不会读取或同步原有剪贴板。' : 'Chinese and emoji use the phone clipboard without installing or switching keyboards. Supplied text may remain there; existing clipboard contents are never read or synced.') : (zh ? 'Agent 会在需要输入时暂停。请接管手机，使用手机自带键盘输入，完成后交还 Agent。' : 'The Agent pauses when text is needed. Take over, type with the phone keyboard, then hand back to the Agent.')}</p>
    {deviceId ? <Button variant="ghost" className="min-h-9 px-2 text-xs text-accent" disabled={disabled || checking} onClick={() => void check()}>{checking ? (zh ? '正在检测…' : 'Checking…') : (zh ? '检测中文输入能力' : 'Check Unicode input')}</Button> : null}
    {result ? <p role="status" className="text-xs leading-relaxed text-fg-muted">{result}</p> : null}
  </div>;
}
