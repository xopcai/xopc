import { VIDEO_AUTO_DURATION, VIDEO_MODELS, WAN_VIDEO_MODEL_REF, type VideoGenerationDraft, type VideoGenerationJob, type VideoGenerationSession } from '@xopcai/gateway-contract';
import { Download, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import { apiUrl } from '@/lib/url';
import { fetchJson } from '@/lib/fetch';

type Language = 'en' | 'zh';

const labels = {
  zh: {
    title: '生成视频', draft: '视频草稿', original: '跟随原图', autoDuration: '自动时长', download: '下载视频',
    previous: '重置前生成的视频', generate: '生成', adjust: '调整', submitting: '正在提交…',
    noKey: '请在「模型与能力」为当前视频服务配置 API Key。',
    confirmation: '也可以回复「就按这个生成」。',
    status: { queued: '排队中', submitting: '正在提交', submitted: '供应商排队中', running: '生成中',
      saving: '正在保存', completed: '已完成', failed: '生成失败', submission_unknown: '提交结果待确认' },
  },
  en: {
    title: 'Generate video', draft: 'Video draft', original: 'Match the image', autoDuration: 'Auto duration', download: 'Download video',
    previous: 'Videos from before the reset', generate: 'Generate', adjust: 'Adjust', submitting: 'Submitting…',
    noKey: 'Configure the video provider API key in Models and capabilities.',
    confirmation: 'You can also reply “confirm video generation”.',
    status: { queued: 'Queued', submitting: 'Submitting', submitted: 'Queued at provider', running: 'Generating',
      saving: 'Saving', completed: 'Ready', failed: 'Generation failed', submission_unknown: 'Submission unconfirmed' },
  },
};

export function isVideoDraftConfirmation(text: string): boolean {
  return /^(就按这个生成|确认生成视频|确认生成|confirm video generation|generate this video)[。！.!]?$/iu.test(text.trim());
}

function jobsUrl(conversationId: string): string {
  return apiUrl(`/api/video-generation/sessions/${encodeURIComponent(conversationId)}/jobs`);
}

function isActive(job: VideoGenerationJob): boolean {
  return !['completed', 'failed', 'submission_unknown'].includes(job.state);
}

export function useChatVideoGeneration(conversationId: string | null, language: Language, options: {
  chatBusy?: boolean;
  readOnly?: boolean;
  onAdjust?: () => void;
} = {}) {
  const { chatBusy = false, readOnly = false, onAdjust } = options;
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
  const request = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState<string>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const draft = data?.draft;
  const draftKey = draft ? `${draft.id}:${draft.revision}` : undefined;
  const configured = Boolean(data?.configured && draft?.modelRef === data.modelRef);
  const confirmDraft = useCallback(async () => {
    if (!url || !draft || !draftKey || request.current || chatBusy || readOnly || !configured) return false;
    request.current = draftKey;
    setSubmitting(draftKey);
    setFailure(undefined);
    try {
      const job = await fetchJson<VideoGenerationJob>(`${url}/confirm-draft`, {
        method: 'POST', body: JSON.stringify({ id: draft.id, revision: draft.revision }),
      });
      await mutate(current => current ? {
        ...current,
        draft: current.draft?.id === job.id ? undefined : current.draft,
        jobs: [job, ...current.jobs.filter(entry => entry.id !== job.id)],
      } : current, { revalidate: true });
      return true;
    } catch (error) {
      setFailure({ key: draftKey, message: error instanceof Error ? error.message : String(error) });
      void mutate();
      return false;
    } finally {
      request.current = null;
      setSubmitting(undefined);
    }
  }, [url, draft, draftKey, chatBusy, readOnly, configured, mutate]);

  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !chatBusy) void mutate();
    wasBusy.current = chatBusy;
  }, [chatBusy, mutate]);

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
    window.addEventListener('session-transcript-updated', refresh);
    return () => {
      window.removeEventListener('session-updated', refresh);
      window.removeEventListener('session-transcript-updated', refresh);
    };
  }, [conversationId, mutate]);

  const timelineEntries = useMemo<ChatTimelineEntry[]>(() => {
    if (!data || !url || !conversationId) return [];
    const renderJob = (job: VideoGenerationJob) =>
      <VideoJobCard key={job.id} job={job} url={`${url}/${encodeURIComponent(job.id)}/video`} language={language} />;
    const active = data.jobs.filter(job => job.transcriptId === data.transcriptId);
    const previous = data.jobs.filter(job => job.transcriptId !== data.transcriptId);
    const entries: ChatTimelineEntry[] = active.map(job => ({
      id: `video-generation:${job.id}`,
      timestamp: job.createdAt,
      content: renderJob(job),
    }));
    if (draft) entries.push({
      id: `video-generation:${draft.id}`,
      timestamp: draft.createdAt,
      content: <VideoDraftCard draft={draft} conversationId={conversationId} language={language}
        configured={configured} modelChanged={draft.modelRef !== data.modelRef}
        readOnly={readOnly} disabled={chatBusy || Boolean(submitting)} submitting={submitting === draftKey}
        error={failure?.key === draftKey ? failure?.message : undefined} onAdjust={onAdjust} onConfirm={confirmDraft} />,
    });
    if (previous.length) entries.push({
      id: 'video-generation:previous-transcripts',
      timestamp: previous[0].createdAt,
      content: <details className="mx-auto w-full max-w-lg rounded-xl border border-edge px-4 py-3">
        <summary className="cursor-pointer text-sm text-fg-muted">{labels[language].previous}</summary>
        <div className="mt-3 space-y-3">{previous.map(renderJob)}</div>
      </details>,
    });
    return entries;
  }, [data, draft, draftKey, configured, readOnly, chatBusy, submitting, failure, onAdjust, confirmDraft, conversationId, language, url]);

  return { draft, confirmDraft, timelineEntries };
}

function VideoDraftCard({ draft, conversationId, language, configured, modelChanged, readOnly, disabled, submitting, error, onAdjust, onConfirm }: {
  draft: VideoGenerationDraft; conversationId: string; language: Language; configured: boolean;
  modelChanged: boolean; readOnly: boolean; disabled: boolean; submitting: boolean; error?: string;
  onAdjust?: () => void; onConfirm: () => Promise<boolean>;
}) {
  const m = labels[language];
  const zh = language === 'zh';
  const duration = draft.duration === VIDEO_AUTO_DURATION ? m.autoDuration : `${draft.duration}s`;
  const price = `¥${(draft.estimatedCostFen / 100).toFixed(2)}`;
  const imageUrl = draft.imageUri
    ? apiUrl(`/api/media/read?${new URLSearchParams({ uri: draft.imageUri, conversationId })}`) : undefined;
  return <article className="mx-auto w-full max-w-lg space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
    <h3 className="flex items-center gap-2 text-sm font-medium text-fg"><Video size={16} aria-hidden />{m.draft}</h3>
    <div className="flex items-start gap-3">
      {imageUrl && <img src={imageUrl} alt={draft.imageName ?? (zh ? '参考图' : 'Reference image')}
        className="size-16 shrink-0 rounded-lg object-cover" />}
      <div className="min-w-0 space-y-1">
        <p className="whitespace-pre-wrap break-words text-sm text-fg">{draft.prompt}</p>
        <p className="text-xs text-fg-muted">
          {[duration, draft.resolution.toLowerCase(), draft.ratio === 'adaptive' ? m.original : draft.ratio,
            `${zh ? '预计' : 'Est.'} ${price}`].join(' · ')}
        </p>
      </div>
    </div>
    <details className="text-xs text-fg-muted">
      <summary className="cursor-pointer">{zh ? '模型与费用说明' : 'Model and estimate'}</summary>
      <p className="mt-1">{VIDEO_MODELS[draft.modelRef].name} · {zh ? '以供应商实际账单为准。' : 'Actual charges are set by the provider.'}
        {draft.duration === VIDEO_AUTO_DURATION && (zh ? ' 自动时长按最长时长估算。' : ' Auto duration is estimated at the model maximum.')}</p>
    </details>
    {!configured && <p className="text-xs text-fg-muted">{modelChanged
      ? (zh ? '默认视频模型已切换，请先调整草稿。' : 'The default video model changed. Adjust the draft first.')
      : m.noKey}</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {!readOnly && <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" className="min-h-9 px-3 py-1" disabled={disabled || !configured}
        onClick={() => void onConfirm()}>{submitting ? m.submitting : m.generate}</Button>
      {onAdjust && <Button variant="ghost" className="min-h-9 px-3 py-1" disabled={disabled} onClick={onAdjust}>{m.adjust}</Button>}
      {configured && !disabled && <p className="text-xs text-fg-muted">{m.confirmation}</p>}
    </div>}
  </article>;
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
