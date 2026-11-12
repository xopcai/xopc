import * as Dialog from '@radix-ui/react-dialog';
import { getVideoDurationOptions, VIDEO_AUTO_DURATION, VIDEO_MODELS, LOCAL_VIDEO_MODEL_REFS, type VideoGenerationDefaults, type VideoModelDefinition, type VideoModelRef, type VideoModelSettings, type VideoResolution } from '@xopcai/gateway-contract';
import { useState } from 'react';
import { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect, Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useVideoModelSettings, videoSettingsPath } from '@/features/video-generation/api';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { ModelUseRow, ModelUseService } from './model-use-layout';

export function VideoModelSettingsPanel({ zh, disabled, onManage }: {
  zh: boolean;
  disabled?: boolean;
  onManage: (providerId: VideoModelDefinition['provider']) => void;
}) {
  const { data, error, mutate } = useVideoModelSettings();
  const { mutate: mutateCache } = useSWRConfig();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [draft, setDraft] = useState<(VideoGenerationDefaults & { modelRef: VideoModelRef }) | null>(null);
  const selected = data && VIDEO_MODELS[data.modelRef];
  const connected = selected && data?.configured[selected.provider];
  const providerLabel = (provider: VideoModelDefinition['provider']) => provider === 'dashscope-cn'
    ? (zh ? '阿里云百炼' : 'Alibaba Cloud Bailian')
    : provider === 'xopc-cloud' ? 'XOPC Cloud' : (zh ? '火山方舟' : 'Volcengine Ark');
  async function save(method: 'PUT' | 'PATCH', payload: object) {
    if (disabled || saving) return false;
    setSaving(true);
    setSaveError('');
    try {
      const settings = await fetchJson<VideoModelSettings>(apiUrl(videoSettingsPath), {
        method, body: JSON.stringify(payload),
      });
      await mutate(settings, { revalidate: false });
      void mutateCache(key => typeof key === 'string' && key.startsWith(apiUrl('/api/video-generation/sessions/')));
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return <>
    <div data-capability="video">
      <ModelUseRow actionColumn
        description={<>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-fg">{zh ? '生成视频' : 'Video generation'}</p>
            {selected && !connected && <span className="text-xs text-fg-subtle">{zh ? '待连接' : 'Connection needed'}</span>}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{zh ? '文生视频和图生视频' : 'Text-to-video and image-to-video'}</p>
        </>}
        picker={data && selected ? <>
          <PopoverSelect placeholder={zh ? '选择模型' : 'Choose a model'}
            ariaLabel={zh ? '选择视频生成模型' : 'Select video generation model'}
            value={data.modelRef} triggerClassName="min-h-11" allowEmpty={false}
            disabled={disabled || saving} onChange={ref => { if (ref !== data.modelRef) void save('PUT', { modelRef: ref }); }}
            options={(data.modelRefs ?? LOCAL_VIDEO_MODEL_REFS).map(ref => {
              const model = VIDEO_MODELS[ref];
              return { value: ref, label: model.name, group: providerLabel(model.provider) };
            })} />
          <ModelUseService name={providerLabel(selected.provider)} manageLabel={zh ? '管理服务' : 'Manage services'}
            onManage={() => onManage(selected.provider)} disabled={disabled || saving} />
          {saving && <p role="status" className="text-xs text-fg-muted">{zh ? '正在切换…' : 'Switching…'}</p>}
          {!draft && saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
        </> : error ? <div role="alert" className="text-sm text-danger">
          {zh ? '视频模型加载失败' : 'Could not load video models'}
          <Button variant="ghost" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button>
        </div> : <Skeleton className="h-11 w-full rounded-xl" />}
        actions={data && selected && <Button variant="ghost" className="min-h-11" disabled={disabled || saving} onClick={() => {
            setSaveError('');
            setDraft({ modelRef: data.modelRef, ...data.defaults });
          }}>{zh ? '设置' : 'Settings'}</Button>
        }
      />
    </div>
  <Dialog.Root open={Boolean(draft)} onOpenChange={open => {
    if (!open && !saving) {
      setDraft(null);
      setSaveError('');
    }
  }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[150] bg-scrim" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[151] flex h-[min(22rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay">
        <header className="border-b border-edge px-5 py-4">
          <Dialog.Title className="font-semibold text-fg">{zh ? '视频生成设置' : 'Video generation settings'}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">
            {draft && VIDEO_MODELS[draft.modelRef].name} · {zh ? '新任务的默认参数' : 'Defaults for new jobs'}
          </Dialog.Description>
        </header>
        {draft && <form className="flex min-h-0 flex-1 flex-col" onSubmit={async event => {
          event.preventDefault();
          if (await save('PATCH', draft)) setDraft(null);
        }}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
            <div className="space-y-1.5">
              <p>{zh ? '默认时长' : 'Default duration'}</p>
              <Select aria-label={zh ? '默认时长' : 'Default duration'} value={String(draft.duration)} disabled={saving}
                onChange={event => setDraft({ ...draft, duration: Number(event.target.value) })}>
                {getVideoDurationOptions(VIDEO_MODELS[draft.modelRef]).map(duration =>
                  <SelectOption key={duration} value={String(duration)}>{duration === VIDEO_AUTO_DURATION ? (zh ? '自动' : 'Auto') : `${duration}s`}</SelectOption>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <p>{zh ? '默认分辨率' : 'Default resolution'}</p>
              <Select aria-label={zh ? '默认分辨率' : 'Default resolution'} value={draft.resolution} disabled={saving}
                onChange={event => setDraft({ ...draft, resolution: event.target.value as VideoResolution })}>
                {VIDEO_MODELS[draft.modelRef].resolutions.map(resolution => <SelectOption key={resolution} value={resolution}>{resolution.toLowerCase()}</SelectOption>)}
              </Select>
            </div>
            {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
          </div>
          <footer className="flex justify-end gap-2 border-t border-edge px-5 py-3">
            <Dialog.Close asChild><Button variant="ghost" disabled={saving}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button>
          </footer>
        </form>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root></>;
}
