import { HIGGS_REALTIME_REF, HIGGS_REALTIME_VOICES, type HiggsVoice, type VoiceCallPreferences, type VoiceCallPreferencesPatch } from '@xopcai/realtime-protocol/voice';
import { useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { openCapabilitySettings } from '@/features/settings/models-hub/open-capability-settings';
import type { BosonVoiceSettings } from '@/features/settings/voice-config-api';

export function PersonalCallSettings({ preferences, settings, failed, disabled, zh, onChange, children }: {
  preferences?: VoiceCallPreferences;
  settings?: BosonVoiceSettings;
  failed: boolean;
  disabled: boolean;
  zh: boolean;
  onChange: (patch: VoiceCallPreferencesPatch) => Promise<boolean>;
  children: (active: boolean) => ReactNode;
}) {
  type EnginePreference = 'auto' | 'natural' | 'assistant';
  const [pendingMode, setPendingMode] = useState<EnginePreference | null>(null);
  const modeRequest = useRef(0);
  const mode = pendingMode ?? preferences?.enginePreference ?? 'auto';
  async function changeMode(enginePreference: EnginePreference) {
    if (enginePreference === mode) return;
    const request = ++modeRequest.current;
    setPendingMode(enginePreference);
    try { await onChange({ enginePreference }); }
    finally { if (request === modeRequest.current) setPendingMode(null); }
  }
  const defaultModel = settings?.defaultForNatural ? HIGGS_REALTIME_REF : settings?.legacyModel;
  const selected = preferences?.naturalModel;
  const effective = selected ?? defaultModel;
  const higgs = effective === HIGGS_REALTIME_REF;
  const models = settings?.naturalModels ?? (settings?.legacyModel
    ? [{ id: settings.legacyModel, name: settings.legacyModelLabel ?? settings.legacyModel, tools: undefined }] : []);
  const effectiveModel = models.find(model => model.id === effective);
  const missingModel = selected && selected !== HIGGS_REALTIME_REF && !models.some(model => model.id === selected);
  return <section className="space-y-3" aria-label={zh ? '语音通话设置' : 'Voice call settings'}>
    <h3 className="text-sm font-medium text-fg">{zh ? '和 Ada 通话' : 'Call Ada'}</h3>
    <p className="text-xs text-fg-muted">{zh ? '自然交流，需要时交办任务。重要内容和结果会留在聊天里。' : 'Talk naturally and delegate when needed. Useful content and results stay in Chat.'}</p>
    <details className="space-y-3">
      <summary className="cursor-pointer text-xs text-fg-muted">{zh ? '高级通话设置' : 'Advanced call settings'}</summary>
      <fieldset disabled={disabled} className="space-y-3">
        <label className="block space-y-1 text-sm"><span>{zh ? '通话引擎' : 'Call engine'}</span>
          <Select aria-label={zh ? '通话引擎' : 'Call engine'} value={mode} onChange={event => { void changeMode(event.target.value as EnginePreference); }}>
            <SelectOption value="auto">{zh ? '自动选择' : 'Automatic'}</SelectOption>
            <SelectOption value="natural">{zh ? '实时语音' : 'Realtime voice'}</SelectOption>
            <SelectOption value="assistant">{zh ? '识别、执行与合成' : 'Transcription, Agent and speech'}</SelectOption>
          </Select>
        </label>
        <div inert={mode === 'natural'} aria-hidden={mode === 'natural'} className={mode === 'natural' ? 'hidden' : ''}>
          {children(mode !== 'natural')}
        </div>
        <div inert={mode === 'assistant'} aria-hidden={mode === 'assistant'} className={`space-y-3 ${mode === 'assistant' ? 'hidden' : ''}`}>
          {!settings && !failed && <Skeleton className="h-10 w-full" />}
          {failed && <p role="alert" className="text-sm text-danger">{zh ? '无法读取自然语音模型。' : 'Could not load natural voice models.'}</p>}
          {settings && <>
            <div className="space-y-1 text-sm">
              <span className="block">{zh ? '模型' : 'Model'}</span>
              <Select aria-label={zh ? '自然语音模型' : 'Natural voice model'} value={selected ?? 'inherit'} onChange={event => onChange({ naturalModel: event.target.value === 'inherit' ? null : event.target.value })}>
                <SelectOption value="inherit">{zh ? '跟随系统' : 'Follow system'}{defaultModel ? ` · ${defaultModel === HIGGS_REALTIME_REF ? 'Higgs Realtime' : settings.legacyModelLabel ?? defaultModel}` : ''}</SelectOption>
                {models.map(model => <SelectOption key={model.id} value={model.id}>{model.name}{model.tools === false ? (zh ? ' · 仅对话' : ' · Conversation only') : ''}</SelectOption>)}
                {(settings.credentialSource || selected === HIGGS_REALTIME_REF) && <SelectOption value={HIGGS_REALTIME_REF}>Higgs Realtime</SelectOption>}
                {missingModel && <SelectOption value={selected}>{selected} · {zh ? '不可用' : 'Unavailable'}</SelectOption>}
              </Select>
              {effectiveModel?.tools === false && <p className="text-xs text-fg-muted">{zh
                ? '此模型仅支持语音交流，不能交办任务。自动选择时会使用具备行动能力的备用引擎。'
                : 'This model supports conversation only. Automatic selection uses the fallback Agent engine to retain actions.'}</p>}
            </div>
            {higgs && <div className="space-y-1 text-sm">
              <span className="block">{zh ? '声音' : 'Voice'}</span>
              <Select aria-label={zh ? '自然语音音色' : 'Natural voice'} value={preferences?.higgsVoice ?? 'inherit'} onChange={event => onChange({ higgsVoice: event.target.value === 'inherit' ? null : event.target.value as HiggsVoice })}>
                <SelectOption value="inherit">{zh ? '跟随系统音色' : 'Follow system voice'} · {settings.voice === 'default' ? (zh ? '模型默认' : 'Model default') : settings.voice}</SelectOption>
                {HIGGS_REALTIME_VOICES.map(id => <SelectOption key={id} value={id}>{id === 'default' ? (zh ? '模型默认' : 'Model default') : id}</SelectOption>)}
              </Select>
            </div>}
            {higgs && <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '音频与隐私说明' : 'Audio and privacy'}</summary>
              <p className="mt-2 leading-relaxed">{zh ? 'Boson 处理本次音频和同一 Ada 对话的有限上下文，语音上下文保留，重要内容和结果进入聊天。' : 'Boson processes call audio and limited context from the same Ada chat. Voice context is retained; useful content and results are shared in Chat.'}</p>
            </details>}
            {(!effective || missingModel || (higgs && !settings.credentialSource)) && <Button type="button" variant="ghost" onClick={() => openCapabilitySettings('conversation')}>
              {zh ? '设置自然语音服务' : 'Set up natural voice'}
            </Button>}
          </>}
        </div>
      </fieldset>
    </details>
  </section>;
}
