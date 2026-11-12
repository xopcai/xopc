import { VIDEO_AUTO_DURATION, VIDEO_MODELS, WAN_VIDEO_MODEL_REF, type VideoGenerationDraft, type VideoGenerationJob, type VideoGenerationSession } from '@xopcai/gateway-contract';
import { Download, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { MediaGenerationCard, MediaGenerationDetails } from '@/features/chat/media-generation-card';
import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import { apiUrl } from '@/lib/url';
import { fetchJson } from '@/lib/fetch';

type Language = 'en' | 'zh';

const labels = {
  zh: {
    title: '视频', draft: '视频草稿', original: '跟随原图', autoDuration: '自动时长', download: '下载视频',
    previous: '重置前生成的视频', generate: '确认生成', adjust: '修改草稿', submitting: '正在提交…',
    noKey: '请在「模型与能力」为当前视频服务配置 API Key。',
    details: '查看完整提示词和模型', estimate: '预计', reference: '参考图',
    status: { queued: '排队中', submitting: '正在提交', submitted: '供应商排队中', running: '生成中',
      saving: '正在保存', completed: '已完成', failed: '生成失败', submission_unknown: '提交结果待确认' },
  },
  en: {
    title: 'Video', draft: 'Video draft', original: 'Match the image', autoDuration: 'Auto duration', download: 'Download video',
    previous: 'Videos from before the reset', generate: 'Confirm generation', adjust: 'Edit draft', submitting: 'Submitting…',
    noKey: 'Configure the video provider API key in Models and capabilities.',
    details: 'View full prompt and model', estimate: 'Est.', reference: 'Reference image',
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
      timestamp: job.draftCreatedAt ?? job.createdAt,
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
      content: <details className="w-full max-w-lg rounded-xl border border-edge-subtle px-4 py-3">
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
  const price = `¥${(draft.estimatedCostFen / 100).toFixed(2)}`;
  const imageUrl = draft.imageUri
    ? apiUrl(`/api/media/read?${new URLSearchParams({ uri: draft.imageUri, conversationId })}`) : undefined;
  return <MediaGenerationCard>
    <h3 className="flex items-center gap-2 text-sm font-medium text-fg"><Video size={16} aria-hidden />{m.draft}</h3>
    <div className="flex items-start gap-3">
      {imageUrl && <img src={imageUrl} alt={draft.imageName ?? m.reference}
        className="size-14 shrink-0 rounded-lg object-cover" />}
      <p className="line-clamp-3 min-w-0 wrap-anywhere text-sm leading-relaxed text-fg">{draft.summary || draft.prompt}</p>
    </div>
    <p className="text-xs leading-relaxed text-fg-muted">
      {videoSpecs(draft, language)} · <span className="font-medium tabular-nums text-fg">{m.estimate} {price}</span>
    </p>
    <VideoPromptDetails video={draft} language={language}>
      {zh ? '以供应商实际账单为准。' : 'Actual charges are set by the provider.'}
      {draft.duration === VIDEO_AUTO_DURATION && (zh ? '自动时长按最长时长估算。' : ' Auto duration is estimated at the model maximum.')}
    </VideoPromptDetails>
    {!configured && <p className="text-xs text-fg-muted">{modelChanged
      ? (zh ? '默认视频模型已切换，请先调整草稿。' : 'The default video model changed. Adjust the draft first.')
      : m.noKey}</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {!readOnly && <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" className="min-h-9 px-3 py-1" disabled={disabled || !configured}
        onClick={() => void onConfirm()}>{submitting ? m.submitting : m.generate}</Button>
      {onAdjust && <Button variant="ghost" className="min-h-9 px-3 py-1" disabled={disabled} onClick={onAdjust}>{m.adjust}</Button>}
    </div>}
  </MediaGenerationCard>;
}

function videoSpecs(video: Pick<VideoGenerationJob, 'duration' | 'resolution' | 'ratio'>, language: Language): string {
  const m = labels[language];
  const duration = video.duration === VIDEO_AUTO_DURATION ? m.autoDuration : language === 'zh' ? `${video.duration} 秒` : `${video.duration}s`;
  return [duration, video.resolution.toLowerCase(), video.ratio === 'adaptive' ? m.original : video.ratio].join(' · ');
}

function VideoPromptDetails({ video, language, children }: {
  video: Pick<VideoGenerationJob, 'prompt' | 'modelRef'>; language: Language; children?: ReactNode;
}) {
  return <MediaGenerationDetails label={labels[language].details}>
    <p className="mt-1 whitespace-pre-wrap wrap-anywhere border-s border-edge px-3 text-sm leading-relaxed text-fg">{video.prompt}</p>
    <p className="mt-2">{VIDEO_MODELS[video.modelRef ?? WAN_VIDEO_MODEL_REF].name}{children && <> · {children}</>}</p>
  </MediaGenerationDetails>;
}

function VideoJobCard({ job, url, language }: {
  job: VideoGenerationJob; url: string; language: Language;
}) {
  const m = labels[language];
  return (
    <MediaGenerationCard>
      <div className="flex items-center justify-between gap-3 text-sm">
        <h3 className="flex items-center gap-2 font-medium text-fg"><Video size={16} aria-hidden />{m.title}</h3>
        <span role="status" className="text-xs text-fg-muted">{m.status[job.state]}</span>
      </div>
      <p className="text-xs text-fg-muted">{videoSpecs(job, language)}</p>
      {job.error && <p className="text-xs text-danger">{job.error}</p>}
      {job.state === 'completed' && <>
        <video controls playsInline preload="none" aria-label={m.title} className="max-h-96 w-full rounded-lg bg-black" src={url} />
        <a href={`${url}?download=1`} download="generated-video.mp4" className="inline-flex items-center gap-2 text-sm text-accent-fg hover:underline">
          <Download size={15} aria-hidden />{m.download}
        </a>
      </>}
      {job.summary && <p className="line-clamp-3 wrap-anywhere text-sm leading-relaxed text-fg">{job.summary}</p>}
      <VideoPromptDetails video={job} language={language}>
        {job.imageName && <span className="wrap-anywhere">{m.reference} · {job.imageName}</span>}
      </VideoPromptDetails>
    </MediaGenerationCard>
  );
}
