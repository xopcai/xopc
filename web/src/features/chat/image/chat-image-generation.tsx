import type { ImageGenerationArtifact, ImageGenerationJob, ImageGenerationSession, ImageJobErrorCode } from '@xopcai/gateway-contract';
import { ChevronLeft, ChevronRight, Download, Ellipsis, ImageIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GenerationPlaceholder } from '@/features/chat/generation-placeholder';
import { MediaGenerationPreview } from '@/features/chat/media-generation-card';
import { findMediaGenerationReplyIndexes } from '@/features/chat/media-generation-replies';
import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
import { cn } from '@/lib/cn';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type Language = 'en' | 'zh';

const errorLabels = {
  zh: {
    provider_rate_limited: '生图服务暂时限流，请稍后再试或检查服务商额度。',
    provider_rejected: '生图请求被服务商拒绝，请调整描述词后再试。',
    provider_failed: '生图服务未能完成生成，你可以在对话中重新发起。',
    credentials_missing: '请检查「模型与能力」中的生图模型配置与 API Key。',
    not_configured: '尚未配置生图模型，请在设置中配置后再试。',
    expired: '生图任务已超时，你可以在对话中重新发起。',
  },
  en: {
    provider_rate_limited: 'The image service is temporarily rate-limited. Try again later or check provider quota.',
    provider_rejected: 'The image service rejected this request. Adjust the prompt and try again.',
    provider_failed: 'The image service could not finish generation. You can start a new request in chat.',
    credentials_missing: 'Check the image model settings and API key in Settings.',
    not_configured: 'No image generation model is configured yet. Configure one in Settings.',
    expired: 'The image generation request timed out. You can start a new request in chat.',
  },
} satisfies Record<Language, Record<ImageJobErrorCode, string>>;

const labels = {
  zh: {
    image: '图片',
    details: '创作详情',
    prompt: '提示词',
    model: '模型',
    download: '下载图片',
    loadFailed: '图片加载失败',
    status: {
      queued: '排队中',
      running: '生成中',
      saving: '正在保存',
      completed: '已完成',
      failed: '生成失败',
    },
  },
  en: {
    image: 'Image',
    details: 'Generation details',
    prompt: 'Prompt',
    model: 'Model',
    download: 'Download image',
    loadFailed: 'Failed to load image',
    status: {
      queued: 'Queued',
      running: 'Generating',
      saving: 'Saving',
      completed: 'Ready',
      failed: 'Generation failed',
    },
  },
};

export function useChatImageGeneration(
  conversationId: string | null,
  language: Language,
  chatBusy: boolean,
  messages: readonly Message[],
) {
  const url = conversationId
    ? apiUrl(`/api/image-generation/sessions/${encodeURIComponent(conversationId)}/jobs`)
    : null;
  const { data, mutate } = useSWR<ImageGenerationSession>(url, fetchJson<ImageGenerationSession>);
  const hasActiveJob = data?.jobs.some(job => !['completed', 'failed'].includes(job.state)) ?? false;

  useEffect(() => {
    if (!chatBusy && url) void mutate();
  }, [chatBusy, mutate, url]);

  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void mutate();
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, mutate]);

  useEffect(() => {
    if (!conversationId) return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string; key?: string }>).detail;
      if ((detail?.conversationId ?? detail?.key) === conversationId) void mutate();
    };
    window.addEventListener('session-updated', refresh);
    window.addEventListener('session-transcript-updated', refresh);
    return () => {
      window.removeEventListener('session-updated', refresh);
      window.removeEventListener('session-transcript-updated', refresh);
    };
  }, [conversationId, mutate]);

  return useMemo<ChatTimelineEntry[]>(() => {
    if (!url || !data?.jobs.length) return [];
    const replyIndexes = findMediaGenerationReplyIndexes(messages, 'image_generation');
    return data.jobs.map(job => ({
      id: `image-generation:${job.id}`,
      timestamp: job.createdAt,
      afterMessageIndex: replyIndexes.get(job.id),
      content: <ImageJobCard key={job.id} job={job} baseUrl={`${url}/${encodeURIComponent(job.id)}/images`} language={language} />,
    }));
  }, [data, language, messages, url]);
}

function useGeneratedImage(src: string | undefined) {
  const [result, setResult] = useState<{ src: string; url: string | null }>();
  useEffect(() => {
    if (!src) return;
    const request = new AbortController();
    let objectUrl: string | undefined;
    void apiFetch(src, { signal: request.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (request.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setResult({ src, url: objectUrl });
    }).catch(() => {
      if (!request.signal.aborted) setResult({ src, url: null });
    });
    return () => {
      request.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return src && result?.src === src ? result.url : undefined;
}

function GeneratedImageGallery({ job, baseUrl, initialIndex, initialUrl, language }: {
  job: ImageGenerationJob;
  baseUrl: string;
  initialIndex: number;
  initialUrl: string | null | undefined;
  language: Language;
}) {
  const [index, setIndex] = useState(initialIndex);
  const position = Math.min(index, job.images.length - 1);
  const asset = job.images[position];
  if (!asset) return null;
  const src = `${baseUrl}/${asset.index}`;
  const m = labels[language];
  return <>
    <GeneratedImagePreview key={asset.index} src={position === initialIndex ? undefined : src}
      cover={initialUrl} title={job.title} loadFailed={m.loadFailed} />
    <footer className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-t border-edge px-2">
      {job.images.length > 1 ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="size-11 p-0" disabled={position === 0}
            aria-label={language === 'zh' ? '上一张' : 'Previous image'} onClick={() => setIndex(position - 1)}>
            <ChevronLeft size={18} aria-hidden />
          </Button>
          <span role="status" className="min-w-11 text-center text-xs tabular-nums text-fg-muted">{position + 1} / {job.images.length}</span>
          <Button variant="ghost" className="size-11 p-0" disabled={position === job.images.length - 1}
            aria-label={language === 'zh' ? '下一张' : 'Next image'} onClick={() => setIndex(position + 1)}>
            <ChevronRight size={18} aria-hidden />
          </Button>
        </div>
      ) : <span />}
      <Button asChild variant="ghost" className="size-11 p-0">
        <a href={`${src}?download=1`} download aria-label={m.download} title={m.download}><Download size={18} aria-hidden /></a>
      </Button>
    </footer>
  </>;
}

function GeneratedImagePreview({ src, cover, title, loadFailed }: {
  src?: string;
  cover: string | null | undefined;
  title: string;
  loadFailed: string;
}) {
  const image = useGeneratedImage(src);
  const url = src ? image : cover;
  return <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-inset p-3 sm:p-4">
    {url === null ? <p role="alert" className="text-sm text-fg-muted">{loadFailed}</p>
      : url ? <img src={url} alt={title} className="block max-h-full max-w-full rounded-lg object-contain" />
        : <Skeleton className="h-full w-full rounded-lg" />}
  </div>;
}

function imageFrameStyle(aspectRatio: string | null, multiple: boolean) {
  const [width, height] = aspectRatio?.split(':').map(Number) ?? [];
  const candidate = width / height;
  const ratio = Number.isFinite(candidate) && candidate > 0 ? candidate : 1;
  const maxHeight = multiple ? 6 : 11;
  return { aspectRatio: ratio, width: `min(22rem, ${maxHeight * ratio}rem)` };
}

function GeneratedImageTile({ job, asset, index, baseUrl, language, multiple }: {
  job: ImageGenerationJob;
  asset: ImageGenerationArtifact;
  index: number;
  baseUrl: string;
  language: Language;
  multiple: boolean;
}) {
  const src = `${baseUrl}/${asset.index}`;
  const url = useGeneratedImage(src);
  const zh = language === 'zh';
  const frameStyle = imageFrameStyle(asset.width && asset.height ? `${asset.width}:${asset.height}` : job.aspectRatio, multiple);
  const title = multiple ? `${job.title} · ${index + 1} / ${job.images.length}` : job.title;
  return <MediaGenerationPreview kind="image" language={language} title={job.title}
    trigger={<button type="button" aria-label={zh ? `预览 ${title}` : `Preview ${title}`}
      className={cn('inline-flex max-w-[min(100%,22rem)] cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-surface-inset',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', !url && 'min-h-11')}
      style={url ? undefined : frameStyle}>
      {url === null ? <span className="p-2 text-xs text-fg-muted">{labels[language].loadFailed}</span>
        : url ? <img src={url} alt="" width={asset.width} height={asset.height}
          className={cn('block h-auto w-auto max-w-full object-contain', multiple ? 'max-h-24' : 'max-h-44')} />
          : <Skeleton className="h-full w-full rounded-none" />}
    </button>}>
    <GeneratedImageGallery job={job} baseUrl={baseUrl} initialIndex={index} initialUrl={url} language={language} />
  </MediaGenerationPreview>;
}

function ImageJobCard({ job, baseUrl, language }: {
  job: ImageGenerationJob;
  baseUrl: string;
  language: Language;
}) {
  const m = labels[language];
  const id = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const completed = job.state === 'completed';
  const failed = job.state === 'failed';
  const pending = !completed && !failed;
  const version = language === 'zh' ? `第 ${job.versionNumber} 版` : `Version ${job.versionNumber}`;
  const count = completed ? job.images.length : job.count;
  const multiple = count > 1;
  const error = job.errorCode ? errorLabels[language][job.errorCode] : undefined;
  const message = error ?? (failed ? job.error || errorLabels[language].provider_failed : undefined);
  const framesClass = cn('w-fit max-w-full self-center',
    multiple && 'grid grid-cols-[repeat(2,minmax(0,max-content))] items-center justify-items-center gap-2');

  return <article className="flex w-fit max-w-[min(100%,24rem)] min-w-[min(100%,13rem)] flex-col gap-2.5 rounded-xl border border-edge bg-surface-panel p-3">
    <div className="flex min-w-0 items-center gap-2.5 [contain:inline-size]">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-edge bg-surface-inset text-accent-fg" aria-hidden>
        <ImageIcon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 wrap-anywhere text-sm leading-tight font-semibold text-fg" title={job.title}>{job.title}</h3>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <span>{m.image} · {version}</span>
          {!completed && <span role="status" className="font-medium">{m.status[job.state]}</span>}
        </p>
      </div>
      <Button variant="ghost" className="size-11 shrink-0 rounded-full p-0 aria-expanded:bg-surface-active"
        aria-label={m.details} title={m.details} aria-controls={id} aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen(current => !current)}>
        <Ellipsis size={18} aria-hidden />
      </Button>
    </div>

    {pending && <div className={framesClass}>
      {Array.from({ length: Math.min(job.count, 4) }).map((_, index) => (
        <GenerationPlaceholder key={index} kind="image" waiting={job.state === 'queued'}
          className="max-w-full" style={imageFrameStyle(job.aspectRatio, multiple)} />
      ))}
    </div>}
    {completed && job.images.length > 0 && <div className={framesClass}>
      {job.images.slice(0, 4).map((asset, index) => (
        <GeneratedImageTile key={asset.index} job={job} asset={asset} index={index} baseUrl={baseUrl} language={language} multiple={multiple} />
      ))}
    </div>}
    {message && <p className={cn('wrap-anywhere text-xs [contain:inline-size]', failed ? 'text-danger' : 'text-fg-muted')}>{message}</p>}
    <div id={id} hidden={!detailsOpen} className="border-t border-edge pt-2.5 [contain:inline-size]">
      {detailsOpen && <dl className="space-y-2 text-xs text-fg-muted">
        <div>
          <dt className="font-medium">{m.prompt}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap wrap-anywhere text-fg">{job.prompt}</dd>
        </div>
        {job.modelRef && <div>
          <dt className="font-medium">{m.model}</dt>
          <dd className="mt-0.5 font-mono wrap-anywhere text-fg">{job.modelRef}</dd>
        </div>}
      </dl>}
    </div>
  </article>;
}
