import { HIGGS_REALTIME_REF, HIGGS_REALTIME_VOICES, type HiggsVoice, type VoiceCallPreferences, type VoiceCallPreferencesPatch, type VoiceMode } from '@xopcai/realtime-protocol/voice';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { SlidingSegmented } from '@/components/ui/sliding-segmented';
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
  const [pendingMode, setPendingMode] = useState<VoiceMode | null>(null);
  const modeRequest = useRef(0);
  const mode = pendingMode ?? preferences?.defaultMode ?? 'assistant';
  const assistantPanel = useRef<HTMLDivElement>(null);
  const naturalPanel = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number>();

  useLayoutEffect(() => {
    const panel = mode === 'assistant' ? assistantPanel.current : naturalPanel.current;
    if (!panel) return;
    const measure = () => setPanelHeight(Math.ceil(panel.getBoundingClientRect().height));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(panel);
    return () => observer?.disconnect();
  }, [mode]);

  async function changeMode(defaultMode: VoiceMode) {
    if (defaultMode === mode) return;
    const request = ++modeRequest.current;
    setPendingMode(defaultMode);
    try {
      await onChange({ defaultMode });
    } finally {
      if (request === modeRequest.current) setPendingMode(null);
    }
  }
  const defaultModel = settings?.defaultForNatural ? HIGGS_REALTIME_REF : settings?.legacyModel;
  const selected = preferences?.naturalModel;
  const effective = selected ?? defaultModel;
  const higgs = effective === HIGGS_REALTIME_REF;
  const missingModel = selected && selected !== HIGGS_REALTIME_REF && selected !== settings?.legacyModel;
  return <section className="space-y-3" aria-label={zh ? '语音通话设置' : 'Voice call settings'}>
    <h3 className="text-sm font-medium text-fg">{zh ? '默认通话方式' : 'Default call mode'}</h3>
    <div className="space-y-3">
      <SlidingSegmented<VoiceMode> aria-label={zh ? '默认通话方式' : 'Default call mode'} value={mode}
        flush buttonClassName="h-9 text-sm"
        options={[{ value: 'assistant', label: zh ? '当前助手' : 'Current assistant' },
          { value: 'natural', label: zh ? '自然语音' : 'Natural voice' }]}
        onChange={defaultMode => { void changeMode(defaultMode); }} />
      <p className="text-xs text-fg-muted">{mode === 'assistant'
        ? (zh ? '使用对话模型，可交办任务' : 'Uses the chat model and can delegate tasks')
        : (zh ? '使用实时语音模型聊天' : 'Talk using a realtime voice model')}</p>
      <fieldset disabled={disabled} style={{ height: panelHeight }}
        className="relative min-w-0 overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none [&_button:focus-visible]:ring-inset">
        <div ref={assistantPanel} inert={mode !== 'assistant'} aria-hidden={mode !== 'assistant'}
          className={`absolute inset-x-0 top-0 min-w-0 transition-opacity duration-150 motion-reduce:transition-none ${mode === 'assistant' ? 'visible opacity-100' : 'invisible opacity-0'}`}>
          {children(mode === 'assistant')}
        </div>
        <div ref={naturalPanel} inert={mode !== 'natural'} aria-hidden={mode !== 'natural'}
          className={`absolute inset-x-0 top-0 min-w-0 space-y-3 transition-opacity duration-150 motion-reduce:transition-none ${mode === 'natural' ? 'visible opacity-100' : 'invisible opacity-0'}`}>
          {!settings && !failed && <Skeleton className="h-10 w-full" />}
          {failed && <p role="alert" className="text-sm text-danger">{zh ? '无法读取自然语音模型。' : 'Could not load natural voice models.'}</p>}
          {settings && <>
            <div className="space-y-1 text-sm">
              <span className="block">{zh ? '模型' : 'Model'}</span>
              <Select aria-label={zh ? '自然语音模型' : 'Natural voice model'} value={selected ?? 'inherit'} onChange={event => onChange({ naturalModel: event.target.value === 'inherit' ? null : event.target.value })}>
                <SelectOption value="inherit">{zh ? '跟随系统' : 'Follow system'}{defaultModel ? ` · ${defaultModel === HIGGS_REALTIME_REF ? 'Higgs Realtime' : settings.legacyModelLabel ?? defaultModel}` : ''}</SelectOption>
                {settings.legacyModel && <SelectOption value={settings.legacyModel}>{settings.legacyModelLabel ?? settings.legacyModel}</SelectOption>}
                {(settings.credentialSource || selected === HIGGS_REALTIME_REF) && <SelectOption value={HIGGS_REALTIME_REF}>Higgs Realtime</SelectOption>}
                {missingModel && <SelectOption value={selected}>{selected} · {zh ? '不可用' : 'Unavailable'}</SelectOption>}
              </Select>
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
              <p className="mt-2 leading-relaxed">{zh ? 'Boson 处理本次音频和同一 Ada 对话的有限上下文，通话字幕保存到原对话。' : 'Boson processes call audio and limited context from the same Ada chat. Captions are saved in that chat.'}</p>
            </details>}
            {(!effective || missingModel || (higgs && !settings.credentialSource)) && <Button type="button" variant="ghost" onClick={() => openCapabilitySettings('conversation')}>
              {zh ? '设置自然语音服务' : 'Set up natural voice'}
            </Button>}
          </>}
        </div>
      </fieldset>
    </div>
  </section>;
}
