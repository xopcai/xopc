import { HIGGS_REALTIME_REF, HIGGS_REALTIME_VOICES, type HiggsVoice, type VoiceCallPreferences, type VoiceCallPreferencesPatch, type VoiceMode } from '@xopcai/realtime-protocol/voice';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { openCapabilitySettings } from '@/features/settings/models-hub/open-capability-settings';
import type { BosonVoiceSettings } from '@/features/settings/voice-config-api';

export function PersonalCallSettings({ preferences, settings, failed, disabled, zh, onChange }: {
  preferences?: VoiceCallPreferences;
  settings?: BosonVoiceSettings;
  failed: boolean;
  disabled: boolean;
  zh: boolean;
  onChange: (patch: VoiceCallPreferencesPatch) => void;
}) {
  const defaultModel = settings?.defaultForNatural ? HIGGS_REALTIME_REF : settings?.legacyModel;
  const selected = preferences?.naturalModel;
  const effective = selected ?? defaultModel;
  const higgs = effective === HIGGS_REALTIME_REF;
  const missingModel = selected && selected !== HIGGS_REALTIME_REF && selected !== settings?.legacyModel;
  return <section className="space-y-3" aria-label={zh ? '语音通话设置' : 'Voice call settings'}>
    <h3 className="text-sm font-medium text-fg">{zh ? '语音通话' : 'Voice calls'}</h3>
    <fieldset disabled={disabled} className="space-y-3">
      <div className="space-y-1 text-sm">
        <span>{zh ? '默认通话方式' : 'Default call mode'}</span>
        <Select aria-label={zh ? '默认通话方式' : 'Default call mode'} value={preferences?.defaultMode ?? 'assistant'} onChange={event => onChange({ defaultMode: event.target.value as VoiceMode })}>
          <SelectOption value="assistant">{zh ? '当前助手 · 可交办任务' : 'Current assistant · Can delegate tasks'}</SelectOption>
          <SelectOption value="natural">{zh ? '自然语音 · 聊天和讨论' : 'Natural voice · Chat and discussion'}</SelectOption>
        </Select>
      </div>
      {!settings && !failed && <Skeleton className="h-10 w-full" />}
      {failed && <p role="alert" className="text-sm text-danger">{zh ? '无法读取自然语音模型。' : 'Could not load natural voice models.'}</p>}
      {settings && <>
        <div className="space-y-1 text-sm">
          <span>{zh ? '自然语音模型' : 'Natural voice model'}</span>
          <Select aria-label={zh ? '自然语音模型' : 'Natural voice model'} value={selected ?? 'inherit'} onChange={event => onChange({ naturalModel: event.target.value === 'inherit' ? null : event.target.value })}>
            <SelectOption value="inherit">{zh ? '跟随系统' : 'Follow system'}{defaultModel ? ` · ${defaultModel === HIGGS_REALTIME_REF ? 'Higgs Realtime' : settings.legacyModelLabel ?? defaultModel}` : ''}</SelectOption>
            {settings.legacyModel && <SelectOption value={settings.legacyModel}>{settings.legacyModelLabel ?? settings.legacyModel}</SelectOption>}
            {(settings.credentialSource || selected === HIGGS_REALTIME_REF) && <SelectOption value={HIGGS_REALTIME_REF}>Higgs Realtime</SelectOption>}
            {missingModel && <SelectOption value={selected}>{selected} · {zh ? '不可用' : 'Unavailable'}</SelectOption>}
          </Select>
        </div>
        {higgs && <div className="space-y-1 text-sm">
          <span>{zh ? '自然语音音色' : 'Natural voice'}</span>
          <Select aria-label={zh ? '自然语音音色' : 'Natural voice'} value={preferences?.higgsVoice ?? 'inherit'} onChange={event => onChange({ higgsVoice: event.target.value === 'inherit' ? null : event.target.value as HiggsVoice })}>
            <SelectOption value="inherit">{zh ? '跟随系统音色' : 'Follow system voice'} · {settings.voice === 'default' ? (zh ? '模型默认' : 'Model default') : settings.voice}</SelectOption>
            {HIGGS_REALTIME_VOICES.map(id => <SelectOption key={id} value={id}>{id === 'default' ? (zh ? '模型默认' : 'Model default') : id}</SelectOption>)}
          </Select>
        </div>}
        {higgs && <p className="text-sm text-fg-muted">{zh ? 'Boson 处理本次音频和同一 Ada 对话的有限上下文，通话字幕保存到原对话。' : 'Boson processes call audio and limited context from the same Ada chat. Captions are saved in that chat.'}</p>}
        {(!effective || missingModel || (higgs && !settings.credentialSource)) && <Button type="button" variant="ghost" onClick={() => openCapabilitySettings('conversation')}>
          {zh ? '设置自然语音服务' : 'Set up natural voice'}
        </Button>}
      </>}
    </fieldset>
  </section>;
}
