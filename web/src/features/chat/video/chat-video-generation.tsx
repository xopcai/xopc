import * as Dialog from '@radix-ui/react-dialog';
import { estimateVideoCostFen, getVideoDurationOptions, isVideoDurationSupported, VIDEO_AUTO_DURATION, VIDEO_IMAGE_MAX_BYTES, VIDEO_MODELS, WAN_VIDEO_MODEL_REF, type VideoGenerationJob, type VideoGenerationSession, type VideoResolution, type VideoRatio } from '@xopcai/gateway-contract';
import { Download, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
import { useVideoModelSettings } from '@/features/video-generation/api';
import { useBlobObjectUrl } from '@/features/file-preview/use-blob-object-url';
import { apiUrl } from '@/lib/url';
import { fetchJson } from '@/lib/fetch';

type Language = 'en' | 'zh';
type ReferenceImage = { uri: string; name: string };

const labels = {
  zh: {
    title: '生成视频', prompt: '描述画面和动作', reference: '参考图（可选）', noReference: '仅使用文字',
    upload: '上传参考图', duration: '时长', resolution: '分辨率', ratio: '比例', autoDuration: '自动', autoEstimate: '自动时长按模型最长时长估算。',
    original: '跟随原图', download: '下载视频', previous: '重置前生成的视频',
    noKey: '请在「模型与能力」为当前视频服务配置 API Key。', close: '关闭', submitting: '正在提交…',
    badFile: '请选择 5 MiB 以内的 PNG、JPEG 或 WebP 图片。',
    transfer: (provider: string) => `参考图与描述将发送给${provider}。`,
    textTransfer: (provider: string) => `描述将发送给${provider}。`,
    seedanceImage: '参考图每边须为 300–6000 像素，宽高比为 0.4–2.5。方舟限制直接上传真人脸部素材。',
    modelChanged: '视频模型已切换，请核对当前模型和费用后重新确认。',
    estimate: '按北京地域原价估算，以供应商账单为准。',
    arkEstimate: '按标准横竖版估算 Token 费用，以实际尺寸和方舟账单为准。',
    status: { queued: '排队中', submitting: '正在提交', submitted: '供应商排队中', running: '生成中',
      saving: '正在保存', completed: '已完成', failed: '生成失败', submission_unknown: '提交结果待确认' },
  },
  en: {
    title: 'Generate video', prompt: 'Describe the scene and motion', reference: 'Reference image (optional)', noReference: 'Text only',
    upload: 'Upload a reference image', duration: 'Duration', resolution: 'Resolution', ratio: 'Aspect ratio', autoDuration: 'Auto', autoEstimate: 'Auto duration is estimated at the model’s maximum duration.',
    original: 'Match the image', download: 'Download video', previous: 'Videos from before the reset',
    noKey: 'Configure the video provider API key in Models and capabilities.', close: 'Close', submitting: 'Submitting…',
    badFile: 'Choose a PNG, JPEG or WebP image up to 5 MiB.',
    transfer: (provider: string) => `Your image and prompt will be sent to ${provider}.`,
    textTransfer: (provider: string) => `Your prompt will be sent to ${provider}.`,
    seedanceImage: 'Use an image with sides of 300–6000 px and a ratio of 0.4–2.5. Ark restricts direct uploads of real faces.',
    modelChanged: 'The video model changed. Review the current model and estimate before confirming again.',
    estimate: 'Estimate at Beijing list price. See the provider bill for actual charges.',
    arkEstimate: 'Token estimate for standard landscape or portrait output. Actual size and Ark billing may vary.',
    status: { queued: 'Queued', submitting: 'Submitting', submitted: 'Queued at provider', running: 'Generating',
      saving: 'Saving', completed: 'Ready', failed: 'Generation failed', submission_unknown: 'Submission unconfirmed' },
  },
};

function jobsUrl(conversationId: string): string {
  return apiUrl(`/api/video-generation/sessions/${encodeURIComponent(conversationId)}/jobs`);
}

function isActive(job: VideoGenerationJob): boolean {
  return !['completed', 'failed', 'submission_unknown'].includes(job.state);
}

export function useChatVideoGeneration(conversationId: string | null, language: Language) {
  const url = conversationId ? jobsUrl(conversationId) : null;
  const { data, mutate } = useSWR<VideoGenerationSession | null>(url, async (key: string) => {
    try {
      return await fetchJson<VideoGenerationSession>(key);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  });
  const hasActiveJob = data?.jobs.some(isActive) ?? false;

  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void mutate();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, mutate]);

  useEffect(() => {
    if (!conversationId) return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string; key?: string }>).detail;
      if ((detail?.conversationId ?? detail?.key) === conversationId) void mutate();
    };
    window.addEventListener('session-updated', refresh);
    return () => window.removeEventListener('session-updated', refresh);
  }, [conversationId, mutate]);

  const timelineEntries = useMemo<ChatTimelineEntry[]>(() => {
    if (!data?.jobs.length || !url) return [];
    const renderJob = (job: VideoGenerationJob) =>
      <VideoJobCard key={job.id} job={job} url={`${url}/${encodeURIComponent(job.id)}/video`} language={language} />;
    const active = data.jobs.filter(job => job.transcriptId === data.transcriptId);
    const previous = data.jobs.filter(job => job.transcriptId !== data.transcriptId);
    const entries: ChatTimelineEntry[] = active.map(job => ({
      id: `video-generation:${job.id}`,
      timestamp: job.createdAt,
      content: renderJob(job),
    }));
    if (previous.length) entries.push({
      id: 'video-generation:previous-transcripts',
      timestamp: previous[0].createdAt,
      content: <details className="mx-auto w-full max-w-lg rounded-xl border border-edge px-4 py-3">
        <summary className="cursor-pointer text-sm text-fg-muted">{labels[language].previous}</summary>
        <div className="mt-3 space-y-3">{previous.map(renderJob)}</div>
      </details>,
    });
    return entries;
  }, [data, language, url]);

  return { data, mutate, timelineEntries };
}

function VideoJobCard({ job, url, language }: {
  job: VideoGenerationJob; url: string; language: Language;
}) {
  const m = labels[language];
  return (
    <article className="mx-auto w-full max-w-lg space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-fg"><Video size={16} aria-hidden />{m.title}</span>
        <span role="status" className="text-xs text-fg-muted">{m.status[job.state]}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-fg">{job.prompt}</p>
      <p className="break-words text-xs text-fg-muted">
        {[VIDEO_MODELS[job.modelRef ?? WAN_VIDEO_MODEL_REF].name, job.duration === VIDEO_AUTO_DURATION ? m.autoDuration : `${job.duration}s`, job.resolution, job.ratio === 'adaptive' ? m.original : job.ratio, job.imageName].filter(Boolean).join(' · ')}
      </p>
      {job.error && <p className="text-xs text-fg-muted">{job.error}</p>}
      {job.state === 'completed' && <>
        <video controls playsInline preload="none" aria-label={m.title} className="max-h-96 w-full rounded-lg bg-black" src={url} />
        <a href={`${url}?download=1`} download="generated-video.mp4" className="inline-flex items-center gap-2 text-sm text-accent-fg hover:underline">
          <Download size={15} aria-hidden />{m.download}
        </a>
      </>}
    </article>
  );
}

export function ChatVideoLauncher({ conversationId, language, messages, data, materialize, onSubmitted }: {
  conversationId: string; language: Language; messages: Message[]; data: VideoGenerationSession | null | undefined;
  materialize: () => Promise<void>; onSubmitted: () => void;
}) {
  const m = labels[language];
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<number>();
  const [resolution, setResolution] = useState<VideoResolution>();
  const [ratio, setRatio] = useState<VideoRatio>('16:9');
  const [imageRatio, setImageRatio] = useState<VideoRatio>('adaptive');
  const [imageUri, setImageUri] = useState('');
  const [upload, setUpload] = useState<File>();
  const modelSettings = useVideoModelSettings(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ signature: string; id: string; upload?: File } | null>(null);
  const images = useMemo(() => {
    const byUri = new Map<string, ReferenceImage>();
    for (const message of messages.slice().reverse()) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.uri?.startsWith('media://') && attachment.mimeType?.match(/^image\/(png|jpeg|webp)$/i)) {
          if (!byUri.has(attachment.uri)) byUri.set(attachment.uri, { uri: attachment.uri, name: attachment.name || m.reference });
        }
      }
    }
    return [...byUri.values()].slice(0, 20);
  }, [messages, m.reference]);
  const hasImage = Boolean(upload || imageUri);
  const uploadUrl = useBlobObjectUrl(open ? upload : undefined);
  const referenceUrl = open && imageUri ? apiUrl(`/api/media/read?${new URLSearchParams({ uri: imageUri, conversationId })}`) : undefined;
  const previewUrl = uploadUrl ?? referenceUrl;
  const modelRef = modelSettings.data?.modelRef ?? data?.modelRef ?? WAN_VIDEO_MODEL_REF;
  const model = VIDEO_MODELS[modelRef];
  const isArk = model.provider === 'volcengine-ark';
  const configured = modelSettings.data?.configured[model.provider] ?? data?.configured;
  const provider = isArk ? (language === 'zh' ? '火山方舟' : 'Volcengine Ark')
    : (language === 'zh' ? '阿里云百炼' : 'Alibaba Cloud Bailian');
  const ratios: readonly VideoRatio[] = hasImage ? model.imageRatios : ['16:9', '9:16'];
  const preferredRatio = hasImage ? imageRatio : ratio;
  const selectedRatio = ratios.includes(preferredRatio) ? preferredRatio : ratios[0];
  const defaults = modelSettings.data?.defaults ?? data?.defaults;
  const preferredDuration = duration ?? defaults?.duration ?? 5;
  const selectedDuration = isVideoDurationSupported(model, preferredDuration) ? preferredDuration : 5;
  const preferredResolution = resolution ?? defaults?.resolution ?? '720P';
  const selectedResolution = model.resolutions.includes(preferredResolution) ? preferredResolution : '720P';
  const estimate = (estimateVideoCostFen(modelRef, selectedDuration, selectedResolution) / 100).toFixed(2);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !prompt.trim()) return;
    if (upload && (upload.size < 1 || upload.size > VIDEO_IMAGE_MAX_BYTES)) {
      setError(m.badFile);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const url = jobsUrl(conversationId);
      if (!data) await materialize();
      const session = await fetchJson<VideoGenerationSession>(url);
      if (session.modelRef !== modelRef) {
        void modelSettings.mutate();
        onSubmitted();
        throw new Error(m.modelChanged);
      }
      if (!session.configured) throw new Error(m.noKey);
      const fields = { transcriptId: session.transcriptId, modelRef, prompt: prompt.trim(), duration: String(selectedDuration),
        ratio: selectedRatio, resolution: selectedResolution, imageUri };
      const signature = JSON.stringify(fields);
      if (attempt.current?.signature !== signature || attempt.current?.upload !== upload) {
        attempt.current = { signature, id: crypto.randomUUID(), upload };
      }
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) if (value) form.set(key, value);
      form.set('id', attempt.current.id);
      if (upload) form.set('image', upload);
      await fetchJson<VideoGenerationJob>(url, { method: 'POST', body: form });
      setOpen(false);
      setPrompt('');
      setUpload(undefined);
      setImageUri('');
      attempt.current = null;
      onSubmitted();
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        void modelSettings.mutate();
        onSubmitted();
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={next => {
      if (submitting.current) return;
      if (next) {
        setDuration(undefined);
        setResolution(undefined);
      }
      setOpen(next);
    }}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="ghost" className="gap-1.5 px-2 py-1 text-xs text-fg-muted">
          <Video size={16} aria-hidden />{m.title}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[91] flex h-[min(34rem,calc(100dvh-2rem))] w-[min(33rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
          <header className="flex items-center justify-between border-b border-edge-subtle px-5 py-4">
            <Dialog.Title className="font-semibold text-fg">{m.title}</Dialog.Title>
            <Dialog.Close asChild><Button variant="ghost" className="p-2" disabled={busy} aria-label={m.close}><X size={16} /></Button></Dialog.Close>
          </header>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <Dialog.Description className="text-fg-muted">{model.name} · {hasImage ? m.transfer(provider) : m.textTransfer(provider)}</Dialog.Description>
              <label className="block space-y-1.5">
                <span>{m.prompt}</span>
                <textarea required maxLength={1000} rows={3} value={prompt} disabled={busy}
                  onChange={event => setPrompt(event.currentTarget.value)}
                  className="w-full resize-none rounded-lg border border-edge bg-surface-base p-2 text-fg focus-visible:outline-2 focus-visible:outline-accent" />
              </label>
              {images.length > 0 && (
                <Select aria-label={m.reference} disabled={busy} value={imageUri || 'none'} onChange={event => {
                  const value = event.target.value;
                  setImageUri(value === 'none' ? '' : value);
                  setUpload(undefined);
                  if (fileInput.current) fileInput.current.value = '';
                }}>
                  <SelectOption value="none">{m.noReference}</SelectOption>
                  {images.map(image => <SelectOption key={image.uri} value={image.uri}>{image.name}</SelectOption>)}
                </Select>
              )}
              <label className="block space-y-1">
                <span>{m.upload}</span>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
                  className="block w-full rounded-lg border border-edge p-2 text-xs text-fg-muted"
                  onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    setUpload(file);
                    if (file) setImageUri('');
                  }} />
              </label>
              {previewUrl && <img src={previewUrl} alt={m.reference} className="h-20 max-w-full rounded-md object-contain" />}
              {hasImage && isArk && <p className="text-xs text-fg-muted">{m.seedanceImage}</p>}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1"><span>{m.duration}</span>
                  <Select aria-label={m.duration} value={String(selectedDuration)} onChange={event => setDuration(Number(event.target.value))} disabled={busy}>
                    {getVideoDurationOptions(model).map(seconds =>
                      <SelectOption key={seconds} value={String(seconds)}>{seconds === VIDEO_AUTO_DURATION ? m.autoDuration : `${seconds}s`}</SelectOption>)}
                  </Select>
                </div>
                <div className="space-y-1"><span>{m.resolution}</span>
                  <Select aria-label={m.resolution} value={selectedResolution} onChange={event => setResolution(event.target.value as VideoResolution)} disabled={busy}>
                    {model.resolutions.map(value => <SelectOption key={value} value={value}>{value.toLowerCase()}</SelectOption>)}
                  </Select>
                </div>
                <div className="space-y-1"><span>{m.ratio}</span>
                  <Select aria-label={m.ratio} value={selectedRatio} onChange={event => (hasImage ? setImageRatio : setRatio)(event.target.value as VideoRatio)} disabled={busy || ratios.length === 1}>
                    {ratios.map(value => <SelectOption key={value} value={value}>{value === 'adaptive' ? m.original : value}</SelectOption>)}
                  </Select>
                </div>
              </div>
              {(error || configured === false) && <p role="alert" className="text-fg-muted">{error || m.noKey}</p>}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-edge-subtle px-5 py-3">
              <div className="text-xs text-fg-muted"><strong className="text-sm text-fg">≈ ¥{estimate}</strong><p>{isArk ? m.arkEstimate : m.estimate} {selectedDuration === VIDEO_AUTO_DURATION && m.autoEstimate}</p></div>
              <Button type="submit" variant="primary" disabled={busy || !prompt.trim() || configured !== true}>{busy ? m.submitting : m.title}</Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
