import type { MusicGenerationJob, MusicGenerationSession, MusicJobErrorCode } from '@xopcai/gateway-contract';
import { Download, Music2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import useSWR from 'swr';

import { MediaGenerationCard, MediaGenerationDetails } from '@/features/chat/media-generation-card';
import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type Language = 'en' | 'zh';

const errorLabels = {
  zh: {
    provider_rate_limited: '音乐服务暂时拒绝了请求。请稍后再试，若持续出现，请检查服务商额度或请求限制。',
    provider_rejected: '音乐服务拒绝了请求。请检查「模型与能力」中的音乐配置后再试。',
    provider_failed: '音乐服务未能完成生成。你可以在对话中重新发起创作。',
    credentials_missing: '请恢复原音乐模型的配置和 API Key，任务会自动继续。',
    status_retrying: '暂时无法查询进度，正在重新查询同一个任务。',
    audio_retrying: '暂时无法保存音频，正在重新下载同一份成品。',
    expired: '任务或音频下载已过期。你可以在对话中重新发起创作。',
  },
  en: {
    provider_rate_limited: 'The music service rejected the request. Try again later. If it persists, check the provider’s quota or request limits.',
    provider_rejected: 'The music service rejected the request. Check the music configuration in Models and capabilities before trying again.',
    provider_failed: 'The music service could not finish generation. You can start a new request in chat.',
    credentials_missing: 'Restore the original music model settings and API key to resume this task.',
    status_retrying: 'Progress is temporarily unavailable. We’re checking the same task again.',
    audio_retrying: 'The audio could not be saved. We’re downloading the same result again.',
    expired: 'The task or audio download has expired. You can start a new request in chat.',
  },
} satisfies Record<Language, Record<MusicJobErrorCode, string>>;

const labels = {
  zh: {
    song: '歌曲', instrumental: '纯音乐', lyrics: '查看歌词', download: '下载音频', details: '创作详情',
    status: { queued: '排队中', submitting: '正在提交', submitted: '供应商排队中', running: '生成中',
      saving: '正在保存', completed: '可播放', failed: '生成失败', submission_unknown: '提交结果待确认' },
    unknown: '暂时无法确认音乐服务是否已接收请求。请先核对服务商的任务或账单，再决定是否重新生成。',
  },
  en: {
    song: 'Song', instrumental: 'Instrumental', lyrics: 'Show lyrics', download: 'Download audio', details: 'Creation details',
    status: { queued: 'Queued', submitting: 'Submitting', submitted: 'Queued at provider', running: 'Generating',
      saving: 'Saving', completed: 'Ready', failed: 'Generation failed', submission_unknown: 'Submission unconfirmed' },
    unknown: 'The music service may have received the request. Check the provider’s tasks or billing before generating again.',
  },
};

export function useChatMusicGeneration(conversationId: string | null, language: Language, chatBusy: boolean) {
  const url = conversationId ? apiUrl(`/api/music-generation/sessions/${encodeURIComponent(conversationId)}/jobs`) : null;
  const { data, mutate } = useSWR<MusicGenerationSession>(url, fetchJson<MusicGenerationSession>);
  const hasActiveJob = data?.jobs.some(job => !['completed', 'failed', 'submission_unknown'].includes(job.state)) ?? false;
  useEffect(() => {
    if (!chatBusy && url) void mutate();
  }, [chatBusy, mutate, url]);

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

  return useMemo<ChatTimelineEntry[]>(() => {
    if (!url || !data) return [];
    return data.jobs.map(job => ({
      id: `music-generation:${job.id}`,
      timestamp: job.createdAt,
      content: <MusicJobCard key={job.id} job={job} audioUrl={`${url}/${encodeURIComponent(job.id)}/audio`} language={language} />,
    }));
  }, [data, language, url]);
}

function MusicJobCard({ job, audioUrl, language }: { job: MusicGenerationJob; audioUrl: string; language: Language }) {
  const m = labels[language];
  const seconds = job.durationMs ? Math.round(job.durationMs / 1000) : null;
  const duration = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  const completed = job.state === 'completed';
  const failed = job.state === 'failed';
  const version = language === 'zh' ? `第 ${job.versionNumber} 版` : `Version ${job.versionNumber}`;
  const specs = [m[job.mode], version];
  if (completed && duration) specs.push(duration);
  const error = job.errorCode ? errorLabels[language][job.errorCode] : undefined;
  const message = job.state === 'submission_unknown' ? m.unknown
    : error ?? (failed ? errorLabels[language].provider_failed : undefined);

  return <MediaGenerationCard>
    <div className="flex items-start justify-between gap-3 text-sm">
      <h3 className="flex min-w-0 items-start gap-2 font-medium text-fg">
        <Music2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 wrap-anywhere">{job.title}</span>
      </h3>
      <span role="status" className="shrink-0 text-xs text-fg-muted">{m.status[job.state]}</span>
    </div>
    <p className="text-xs text-fg-muted">{specs.join(' · ')}</p>
    {message && <p className={failed ? 'text-xs text-danger' : 'text-xs text-fg-muted'}>{message}</p>}
    {completed && <>
      <audio controls preload="none" aria-label={job.title} src={audioUrl} className="w-full" />
      <a href={`${audioUrl}?download=1`} download="music.mp3" className="inline-flex items-center gap-2 text-sm text-accent-fg hover:underline">
        <Download size={15} aria-hidden />{m.download}
      </a>
    </>}
    <p className="line-clamp-3 wrap-anywhere text-sm leading-relaxed text-fg">{job.prompt}</p>
    {completed && job.mode === 'song' && job.lyrics && <MediaGenerationDetails label={m.lyrics}>
      <p className="mt-1 whitespace-pre-wrap wrap-anywhere border-s border-edge px-3 text-sm leading-relaxed text-fg">{job.lyrics}</p>
    </MediaGenerationDetails>}
    <MediaGenerationDetails label={m.details}>
      <p className="mt-1 whitespace-pre-wrap wrap-anywhere border-s border-edge px-3 text-sm leading-relaxed text-fg">{job.prompt}</p>
      <p className="mt-2 wrap-anywhere">{job.modelRef}{job.errorCode === 'provider_rate_limited' && ' · HTTP 429'}</p>
    </MediaGenerationDetails>
  </MediaGenerationCard>;
}
