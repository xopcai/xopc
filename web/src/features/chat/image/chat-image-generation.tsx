import type { ImageGenerationJob, ImageGenerationSession, ImageJobErrorCode } from '@xopcai/gateway-contract';
import { Download, Ellipsis, ImageIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { findMediaGenerationReplyIndexes } from '@/features/chat/media-generation-replies';
import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
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

function AuthenticatedImageTile({
  src,
  alt,
  downloadLabel,
  loadFailedLabel,
}: {
  src: string;
  alt: string;
  downloadLabel: string;
  loadFailedLabel: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);
    apiFetch(src)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg border border-edge bg-surface-inset text-xs text-fg-muted">
        {loadFailedLabel}
      </div>
    );
  }
  if (!blobUrl) {
    return <Skeleton className="aspect-square w-full rounded-lg" />;
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-edge bg-surface-inset">
      <a href={blobUrl} target="_blank" rel="noreferrer" className="block">
        <img
          src={blobUrl}
          alt={alt}
          className="h-auto w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]"
        />
      </a>
      <a
        href={blobUrl}
        download="image.png"
        aria-label={downloadLabel}
        title={downloadLabel}
        className="absolute right-2 bottom-2 inline-flex size-8 items-center justify-center rounded-full border border-edge bg-surface-panel/90 text-fg opacity-0 shadow-sm backdrop-blur-xs transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Download size={15} aria-hidden />
      </a>
    </div>
  );
}

function ImageJobCard({
  job,
  baseUrl,
  language,
}: {
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
  const error = job.errorCode ? errorLabels[language][job.errorCode] : undefined;
  const message = error ?? (failed ? job.error || errorLabels[language].provider_failed : undefined);

  return (
    <article className="flex w-full min-w-0 max-w-[26rem] flex-col gap-2.5 rounded-xl border border-edge bg-surface-panel p-3 sm:p-3.5">
      <div className="flex items-center gap-2.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-edge bg-surface-inset text-accent-fg" aria-hidden>
          <ImageIcon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="wrap-anywhere text-sm leading-tight font-semibold tracking-tight text-fg">{job.title}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span>{m.image} · {version}</span>
            {!completed && <span role="status" className="font-medium">{m.status[job.state]}</span>}
          </p>
        </div>
        <Button
          variant="ghost"
          className="size-9 shrink-0 rounded-full p-0 aria-expanded:bg-surface-active aria-expanded:text-fg"
          aria-label={m.details}
          title={m.details}
          aria-controls={`${id}-details`}
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen(prev => !prev)}
        >
          <Ellipsis size={18} aria-hidden />
        </Button>
      </div>

      {pending && (
        <div className={job.count > 1 ? 'grid grid-cols-2 gap-2' : 'block'}>
          {Array.from({ length: Math.min(job.count, 4) }).map((_, idx) => (
            <Skeleton key={idx} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      )}

      {message && <p className={failed ? 'text-xs text-danger' : 'text-xs text-fg-muted'}>{message}</p>}

      {completed && job.images.length > 0 && (
        <div className={job.images.length > 1 ? 'grid grid-cols-2 gap-2' : 'block'}>
          {job.images.map(img => (
            <AuthenticatedImageTile
              key={img.index}
              src={`${baseUrl}/${img.index}`}
              alt={job.title}
              downloadLabel={m.download}
              loadFailedLabel={m.loadFailed}
            />
          ))}
        </div>
      )}

      <div id={`${id}-details`} hidden={!detailsOpen} className="border-t border-edge pt-2.5">
        {detailsOpen && (
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="font-medium text-fg-muted">{m.prompt}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-fg">{job.prompt}</dd>
            </div>
            {job.modelRef && (
              <div>
                <dt className="font-medium text-fg-muted">{m.model}</dt>
                <dd className="mt-0.5 font-mono text-fg">{job.modelRef}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}
