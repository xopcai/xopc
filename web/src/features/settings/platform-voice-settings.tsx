import { useState } from 'react';
import useSWR from 'swr';
import { voiceSettingsCatalogSchema, type VoiceSelection } from '@xopcai/realtime-protocol/voice';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';

export function PlatformVoiceSettings({ disabled = false }: { disabled?: boolean }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data, mutate, error: loadError } = useSWR(apiUrl('/api/voice/catalog'), async (url: string) => {
    const response = await fetchJson<{ payload: unknown }>(url);
    return voiceSettingsCatalogSchema.parse(response.payload);
  });
  const labels: Record<VoiceSelection['mode'], string> = zh ? {
    transcription: '录音转文字', 'transcription.stream': '实时听写 / 语音助手输入', speech: '消息朗读', 'speech.stream': '语音助手输出', conversation: '自然语音对话',
  } : { transcription: 'Recorded transcription', 'transcription.stream': 'Live dictation / assistant input', speech: 'Message readout', 'speech.stream': 'Assistant speech', conversation: 'Natural conversation' };
  const request = async (selection?: VoiceSelection) => {
    if (!data) return;
    setBusy(true); setError('');
    try {
      const response = await fetchJson<{payload: unknown}>(apiUrl(selection ? '/api/voice/selection' : '/api/voice/catalog/refresh'), {
        method: selection ? 'PUT' : 'POST', ...(selection ? { body: JSON.stringify({ revision: data.revision, selection }) } : {}),
      });
      await mutate(voiceSettingsCatalogSchema.parse(response.payload), false);
      await revalidateGatewayConfig();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); await mutate(); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border border-edge p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-medium">{zh ? 'XOPC 托管语音模型' : 'XOPC managed voice models'}</h3><Button variant="secondary" disabled={busy || disabled || !data} onClick={() => void request()}>{zh ? '刷新目录' : 'Refresh catalog'}</Button></div>
    <p className="text-sm text-fg-muted">{zh ? '各设备共用此 Gateway 的模型设置，修改在下次调用生效。仅显示支持对应场景的已发布模型。' : 'Devices share this gateway’s selections. Changes apply to the next call. Only published models supporting each mode are shown.'}</p>
    {error || loadError ? <p role="alert" className="text-sm text-red-600">{error || String(loadError)}</p> : null}
    {!data ? <Skeleton className="h-48 w-full" /> : (Object.keys(labels) as VoiceSelection['mode'][]).map(mode => {
      const selected = data.selections.find(item => item.mode === mode);
      const models = data.models.filter(model => model.voice.modes.includes(mode));
      const model = models.find(item => item.id === selected?.model);
      return <div key={mode} className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span>{labels[mode]}</span><Select className="w-full" value={selected?.model ?? ''} disabled={busy || disabled || !models.length} onChange={event => void request({ mode, model: event.target.value })}>
          <SelectOption value="" disabled>{zh ? '选择模型' : 'Choose model'}</SelectOption>
          {selected && !model ? <SelectOption value={selected.model} disabled>{selected.model} · {zh ? '不可用' : 'Unavailable'}</SelectOption> : null}
          {models.map(model => <SelectOption key={model.id} value={model.id}>{model.name}</SelectOption>)}
        </Select>{!models.length ? <span className="text-xs text-fg-muted">{zh ? '暂无可用模型' : 'No available model'}</span> : null}</label>
        {model && model.voice.voices.length > 0 ? <label className="space-y-1 text-sm"><span>{zh ? '音色' : 'Voice'}</span><Select className="w-full" value={selected?.voice ?? ''} disabled={busy || disabled} onChange={event => void request({ mode, model: model.id, voice: event.target.value })}>
          {model.voice.voices.map(voice => <SelectOption key={voice.id} value={voice.id}>{voice.name}</SelectOption>)}
        </Select></label> : null}
      </div>;
    })}
  </section>;
}
