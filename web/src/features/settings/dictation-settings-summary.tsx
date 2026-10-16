import { useEffect } from 'react';
import { CapabilitySettingsLink } from './models-hub/capability-settings-link';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchDictationRoute } from '@/features/chat/composer/voice-transcribe-api';

export function DictationSettingsSummary({ zh }: { zh: boolean }) {
  const { data, error, mutate } = useSWR('voice-dictation-route', () => fetchDictationRoute(AbortSignal.timeout(15_000)));
  useEffect(() => {
    const refresh = () => { void mutate(); };
    window.addEventListener('voice-config-changed', refresh);
    window.addEventListener('config-reload', refresh);
    return () => {
      window.removeEventListener('voice-config-changed', refresh);
      window.removeEventListener('config-reload', refresh);
    };
  }, [mutate]);
  return <section className="space-y-2 rounded-xl border border-edge p-4 text-sm">
    <h2 className="font-medium text-fg">{zh ? '聊天听写' : 'Chat dictation'}</h2>
    <p className="text-fg-muted">{zh ? '听写默认复用录音识别模型，无需另外接入服务。已单独配置流式识别时沿用原设置；实时语音对话单独配置。' : 'Dictation reuses recorded-audio recognition. Explicit streaming settings remain supported; realtime conversations are configured separately.'}</p>
    {!data && !error ? <Skeleton className="h-5 w-64 max-w-full" /> : <p role={error ? 'alert' : 'status'} className="text-fg-muted">
      {error ? (zh ? '暂时无法读取听写状态。' : 'Dictation status could not be loaded.')
        : data?.mode === 'recorded' ? (zh ? `当前使用 ${data.provider}，点击完成后转为文字。` : `Using ${data.provider}. Choose Finish to transcribe.`)
          : data?.mode === 'streaming' ? (zh ? `当前使用流式识别${data.provider ? ` · ${data.provider}` : ''}。` : `Using streaming recognition${data.provider ? ` · ${data.provider}` : ''}.`)
            : (zh ? '听写未就绪，请检查识别模型或已有的流式配置。' : 'Check the recognition model or existing streaming configuration.')}
    </p>}
    {data?.mode !== 'recorded' ? <CapabilitySettingsLink className="inline-block text-accent-fg hover:underline" to="/settings/capabilities/voice?voiceTab=service&use=transcription">{zh ? '查看语音服务配置' : 'View voice service settings'}</CapabilitySettingsLink> : null}
  </section>;
}
