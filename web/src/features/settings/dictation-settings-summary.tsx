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
    <h2 className="font-medium text-fg">{zh ? '同时用于聊天听写' : 'Also used for chat dictation'}</h2>
    <p className="text-fg-muted">{zh ? '默认与录音识别共用模型。已有的独立听写设置会保留。' : 'Dictation shares this recognition model. Existing separate dictation settings are preserved.'}</p>
    {!data && !error ? <Skeleton className="h-5 w-64 max-w-full" /> : <p role={error ? 'alert' : 'status'} className="text-fg-muted">
      {error ? (zh ? '暂时无法读取听写状态。' : 'Dictation status could not be loaded.')
        : data?.mode === 'recorded' ? (zh ? `当前使用 ${data.provider}，点击完成后转为文字。` : `Using ${data.provider}. Choose Finish to transcribe.`)
          : data?.mode === 'streaming' ? (zh ? `当前使用流式识别${data.provider ? ` · ${data.provider}` : ''}。` : `Using streaming recognition${data.provider ? ` · ${data.provider}` : ''}.`)
            : (zh ? '听写未就绪，请检查识别模型或已有的流式配置。' : 'Check the recognition model or existing streaming configuration.')}
    </p>}
    {data?.mode !== 'recorded' ? <CapabilitySettingsLink className="inline-block text-accent-fg hover:underline" to="/settings/capabilities/models?view=services&use=transcription">{zh ? '管理识别服务' : 'Manage recognition services'}</CapabilitySettingsLink> : null}
  </section>;
}
