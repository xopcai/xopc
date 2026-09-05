import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import type { VoiceSettingsMessages } from '@/i18n/messages';
import { selectTriggerClass } from '@/lib/form-field-width';

import { VoiceApiKeyField, type VoiceApiKeyFieldLabels } from './voice-api-key-field';
import { fetchRealtimeVoiceStatus, fetchTtsVoices } from './voice-config-api';
import { VoiceDiagnostics } from './voice-diagnostics';
import { configureRealtimeService } from './voice-service-setup';
import type { VoiceSettingsState, SttProviderListEntry } from './voice-settings.types';


export function VoiceSetup({ section, v, form, pending, apiKeyLabels, sttProviders, onChange }: {
  section: 'service' | 'listening' | 'diagnostics';
  v: VoiceSettingsMessages;
  form: VoiceSettingsState;
  pending: boolean;
  apiKeyLabels: VoiceApiKeyFieldLabels;
  sttProviders: SttProviderListEntry[];
  onChange: (form: VoiceSettingsState) => void;
}) {
  const s = v.setup;
  const [editingKey, setEditingKey] = useState(false);
  const signature = JSON.stringify(form);
  const [verified, setVerified] = useState({ signature, input: false, output: false });
  if (verified.signature !== signature) setVerified({ signature, input: false, output: false });
  const { data: status, error, isLoading } = useSWR(
    pending ? null : ['voice-realtime-status', signature], fetchRealtimeVoiceStatus,
    { revalidateOnFocus: true },
  );
  const realtime = form.voice.realtime;
  const provider = form.stt.provider;
  const selection = realtime.tts;
  const outputProvider = selection?.provider ?? status?.tts?.provider;
  const outputModel = status?.tts?.model;
  const { data: voices = [] } = useSWR(
    outputProvider && outputModel ? ['realtime-voices', outputProvider, outputModel] : null,
    () => fetchTtsVoices(outputProvider!, outputModel!, 'realtime'),
    { revalidateOnFocus: false },
  );
  const realtimeVoices = outputProvider === 'alibaba'
    ? voices.filter((voice) => ['Cherry', 'Ethan', 'Serena', 'Chelsie'].includes(voice.id))
    : voices;
  const key = typeof form.stt.providers?.alibaba?.apiKey === 'string' ? form.stt.providers.alibaba.apiKey : '';
  const keyConfigured = Boolean(key) || sttProviders.some((entry) => entry.id === 'alibaba' && entry.configured);
  const native = realtime.defaultEngine === 'omni';
  const currentVoice = native ? realtime.omni?.voice ?? 'Cherry' : selection?.voice ?? status?.tts?.voice ?? '';
  const voiceOptions = native ? ['Cherry', 'Ethan', 'Serena', 'Chelsie'].map((id) => ({ id, name: id })) : realtimeVoices;
  const canListen = Boolean(status?.enabled && status.stt);
  const canSpeak = Boolean(status?.enabled && status.tts);
  const updateRealtime = (patch: Partial<typeof realtime>) => onChange({
    ...form, voice: { ...form.voice, realtime: { ...realtime, ...patch } },
  });
  const configure = (id: 'alibaba' | 'xopc-cloud') => onChange(configureRealtimeService(form, id));
  const statusLabel = (configured: boolean, passed: boolean) => !realtime.enabled ? s.disabled : pending ? s.pending : configured ? passed && verified.signature === signature ? s.verified : s.unverified : s.needsSetup;

  return (
    <section className="space-y-5 rounded-xl border border-edge bg-surface-panel p-4 sm:p-5" aria-label={s.service}>
      {section === 'service' ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-4">
        <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" role="switch" aria-checked={realtime.enabled} className="size-4 accent-accent" checked={realtime.enabled} onChange={(e) => { if (e.target.checked) configure(provider === 'alibaba' ? 'alibaba' : 'xopc-cloud'); else updateRealtime({ enabled: false }); }} />{s.enable}</label>
      </div>
      {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{s.statusError}</p> : null}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-fg">{s.service}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['xopc-cloud', 'alibaba'] as const).map((id) => <label key={id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-edge px-3 py-3 text-sm text-fg has-checked:border-accent/60">
            <input type="radio" name="realtime-service" value={id} checked={provider === id} onChange={() => configure(id)} className="mt-1 accent-accent" />
            <span><span className="block font-medium">{id === 'xopc-cloud' ? s.hosted : s.ownKey}</span><span className="mt-1 block text-xs text-fg-muted">{id === 'xopc-cloud' ? s.hostedHint : s.ownKeyHint}</span></span>
          </label>)}
        </div>
      </fieldset>
      {provider !== 'alibaba' && provider !== 'xopc-cloud' ? <p className="text-xs text-fg-muted">{s.customProvider.replace('{provider}', provider)}</p> : null}
      {provider === 'alibaba' ? <div className="space-y-2 text-xs">
        {keyConfigured && !editingKey ? <div className="flex items-center justify-between gap-2"><span className="text-fg-muted">{s.keyConfigured}</span><Button type="button" variant="ghost" onClick={() => setEditingKey(true)}>{s.changeKey}</Button></div> : <>
          <label htmlFor="realtime-api-key" className="font-medium text-fg">{v.stt.apiKey}</label>
          <VoiceApiKeyField kind="stt" providerId="alibaba" fieldId="realtime-api-key" value={key} labels={{ ...apiKeyLabels, maskedHelp: '' }} onChange={(apiKey) => onChange({ ...form, stt: { ...form.stt, providers: { ...form.stt.providers, alibaba: { ...form.stt.providers?.alibaba, apiKey } } } })} />
          <p className="text-fg-muted">{s.keyHint}</p>
        </>}
      </div> : null}
      {provider === 'xopc-cloud' ? <p className="text-xs text-fg-muted">{s.hostedAccountHint} <Link className="text-accent hover:underline" to="/settings/capabilities/models">{s.manageAccount}</Link></p> : null}
      {!selection && !pending && !status?.tts && (provider === 'alibaba' || provider === 'xopc-cloud') ? <div className="rounded-lg bg-surface-base p-3 text-xs">
        <p className="font-medium text-fg">{s.finishSetup}</p>
        <p className="mt-1 text-fg-muted">{form.tts.provider === 'edge' ? s.edgeHint : s.outputHint}</p>
        <Button className="mt-2" type="button" variant="secondary" onClick={() => configure(provider)}>{s.configureConversation}</Button>
      </div> : null}
      <label className="block space-y-2 text-sm"><span>{v.experience.defaultEngine}</span>
        <Select value={realtime.defaultEngine} className={selectTriggerClass} onChange={(e) => updateRealtime({ defaultEngine: e.target.value as 'agent' | 'omni' })}>
          <SelectOption value="agent">{v.experience.agent}</SelectOption><SelectOption value="omni">{v.experience.omni}</SelectOption>
        </Select>
      </label>
      <p className="text-xs text-fg-muted">{realtime.defaultEngine === 'agent' ? v.experience.agentHint : v.experience.omniHint} {v.experience.nextCall}</p>
      </> : null}
      {section === 'listening' ? <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="realtime-voice" className="text-sm font-medium text-fg">{s.voice}</label>
        <Select id="realtime-voice" className={`${selectTriggerClass} w-full sm:w-56`} value={currentVoice} disabled={native ? !realtime.omni : !selection && !status?.tts} onChange={(e) => {
          if (native && realtime.omni) { updateRealtime({ omni: { ...realtime.omni, voice: e.target.value } }); return; }
          if (outputProvider === 'alibaba' || outputProvider === 'xopc-cloud') updateRealtime({ tts: { provider: outputProvider, ...(e.target.value ? { voice: e.target.value } : {}) }, ...(realtime.omni && ['Cherry', 'Ethan', 'Serena', 'Chelsie'].includes(e.target.value) ? { omni: { ...realtime.omni, voice: e.target.value } } : {}) });
        }}>
          {!native ? <SelectOption value="">{s.defaultVoice}</SelectOption> : null}
          {currentVoice && !voiceOptions.some((voice) => voice.id === currentVoice) ? <SelectOption value={currentVoice}>{currentVoice}</SelectOption> : null}
          {voiceOptions.map((voice) => <SelectOption key={voice.id} value={voice.id}>{voice.name}</SelectOption>)}
        </Select>
      </div>
      <label className="flex items-center justify-between gap-4 text-sm text-fg"><span>{s.bargeIn}<span className="mt-1 block text-xs text-fg-muted">{v.realtime.bargeInDescription}</span></span><input type="checkbox" role="switch" aria-checked={realtime.bargeIn} checked={realtime.bargeIn} className="size-4 accent-accent" onChange={(e) => updateRealtime({ bargeIn: e.target.checked })} /></label>
      </> : null}
      {section === 'diagnostics' ? <>
        {isLoading ? <Skeleton className="h-16 w-full" /> : <div className="space-y-2 text-sm" role="status">
          <p>{v.experience.dictationReady} · {statusLabel(canListen, verified.input)}</p>
          <p>{v.experience.agentReady} · {statusLabel(canListen && canSpeak, verified.input && verified.output)}</p>
          <p>{v.experience.omniReady} · {statusLabel(Boolean(status?.enabled && status.omni), false)}</p>
        </div>}
        <p className="text-xs text-fg-muted">{v.experience.configurationOnly}</p>
      <VoiceDiagnostics key={`${signature}:${JSON.stringify(status)}`} v={v} canListen={canListen} canSpeak={canSpeak} disabled={pending || isLoading || Boolean(error)} onVerified={(result) => setVerified({ signature, ...result })} />
      </> : null}
    </section>
  );
}
