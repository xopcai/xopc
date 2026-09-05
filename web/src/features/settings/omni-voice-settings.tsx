import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { useLocaleStore } from '@/stores/locale-store';

import type { VoiceSettingsState } from './voice-settings.types';

type RealtimeSettings = VoiceSettingsState['voice']['realtime'];

export function OmniVoiceSettings({ value, onChange }: {
  value: RealtimeSettings['omni'];
  onChange: (omni: NonNullable<RealtimeSettings['omni']>) => void;
}) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const label = (en: string, cn: string) => zh ? cn : en;
  const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg';
  const update = (patch: Partial<NonNullable<RealtimeSettings['omni']>>) => {
    if (value) onChange({ ...value, ...patch });
  };
  return <details className="space-y-3 rounded-xl border border-edge p-4">
    <summary className="cursor-pointer text-sm font-medium text-fg">{label('Natural conversation · advanced', '自然对话 · 高级设置')}</summary>
    <p className="text-sm text-fg-muted">{label('Calls continue the same session using recent history. Service and credentials are shared with voice setup; override them here only when needed.', '通话会接续同一会话的近期历史。默认共用语音服务与凭据，仅在需要独立配置时修改。')}</p>
    {!value ? <Button variant="secondary" onClick={() => onChange({ provider: 'xopc-cloud', model: 'qwen3-omni-flash-realtime', voice: 'Cherry', instructions: 'You are a friendly voice companion. You cannot execute tools.' })}>{label('Configure natural conversation', '配置自然聊天')}</Button> : <>
      <label className="block space-y-1 text-sm"><span>{label('Connection', '连接方式')}</span>
        <Select value={value.provider} onChange={(event) => onChange({ model: value.model, voice: value.voice, instructions: value.instructions, provider: event.target.value as 'alibaba' | 'xopc-cloud' })}>
          <SelectOption value="xopc-cloud">XOPC Platform</SelectOption><SelectOption value="alibaba">DashScope · {label('Your API key', '自有 API Key')}</SelectOption>
        </Select>
      </label>
      <p className="text-xs text-fg-muted">{value.provider === 'xopc-cloud' ? label('Uses your XOPC sign-in and the platform’s published Omni route and credits.', '使用 XOPC 登录授权、平台发布的 Omni 路由和额度。') : label('Leave empty to use the shared voice service credential.', '留空使用语音服务中已配置的凭据。')}</p>
      <p className="font-mono text-xs text-fg-muted">{value.model}</p>
      {value.provider === 'alibaba' ? <label className="block space-y-1 text-sm"><span>API Key</span><input className={inputClass} type="password" autoComplete="new-password" value={value.apiKey ?? ''} onChange={(event) => update({ apiKey: event.target.value })} /></label> : null}
      <label className="block space-y-1 text-sm"><span>{label('Endpoint override (optional)', '自定义服务地址（可选）')}</span><input className={inputClass} value={value.baseUrl ?? ''} placeholder={value.provider === 'alibaba' ? 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime' : 'https://router.xopc.ai/v1'} onChange={(event) => update({ baseUrl: event.target.value.trim() || undefined })} /></label>
      <label className="block space-y-1 text-sm"><span>{label('Voice', '音色')}</span><Select value={value.voice} onChange={(event) => update({ voice: event.target.value })}>{['Cherry', 'Ethan', 'Serena', 'Chelsie'].map((voice) => <SelectOption key={voice} value={voice}>{voice}</SelectOption>)}</Select></label>
      <label className="block space-y-1 text-sm"><span>{label('Conversation instructions', '聊天指令')}</span><textarea className={inputClass} rows={3} maxLength={8000} value={value.instructions} onChange={(event) => update({ instructions: event.target.value })} /></label>
    </>}
  </details>;
}
