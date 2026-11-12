import { SpaceGeneratedMediaLink } from '@/features/space/space-artifact-link';
import type { MusicGenerationJob, MusicGenerationSession, MusicJobErrorCode } from '@xopcai/gateway-contract';
import { Ellipsis, Music2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { findMediaGenerationReplyIndexes } from '@/features/chat/media-generation-replies';
import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { MusicPlayer } from './music-player';

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
    song: '歌曲', instrumental: '纯音乐', details: '创作详情',
    prompt: '提示词', model: '模型',
    status: { queued: '排队中', submitting: '正在提交', submitted: '供应商排队中', running: '生成中',
      saving: '正在保存', completed: '可播放', failed: '生成失败', submission_unknown: '提交结果待确认' },
    unknown: '暂时无法确认音乐服务是否已接收请求。请先核对服务商的任务或账单，再决定是否重新生成。',
  },
  en: {
    song: 'Song', instrumental: 'Instrumental', details: 'Creation details',
    prompt: 'Prompt', model: 'Model',
    status: { queued: 'Queued', submitting: 'Submitting', submitted: 'Queued at provider', running: 'Generating',
      saving: 'Saving', completed: 'Ready', failed: 'Generation failed', submission_unknown: 'Submission unconfirmed' },
    unknown: 'The music service may have received the request. Check the provider’s tasks or billing before generating again.',
  },
};

export function useChatMusicGeneration(
  conversationId: string | null, language: Language, chatBusy: boolean, messages: readonly Message[],
) {
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
    if (!url || !data?.jobs.length) return [];
    const replyIndexes = findMediaGenerationReplyIndexes(messages, 'music_generation');
    return data.jobs.map(job => ({
      id: `music-generation:${job.id}`,
      timestamp: job.createdAt,
      afterMessageIndex: replyIndexes.get(job.id),
      content: <MusicJobCard key={job.id} job={job} audioUrl={`${url}/${encodeURIComponent(job.id)}/audio`} language={language} />,
    }));
  }, [data, language, messages, url]);
}

function MusicJobCard({ job, audioUrl, language }: { job: MusicGenerationJob; audioUrl: string; language: Language }) {
  const m = labels[language];
  const id = useId();
  const [openPanel, setOpenPanel] = useState<'lyrics' | 'details' | null>(null);
  const completed = job.state === 'completed';
  const failed = job.state === 'failed';
  const version = language === 'zh' ? `第 ${job.versionNumber} 版` : `Version ${job.versionNumber}`;
  const error = job.errorCode ? errorLabels[language][job.errorCode] : undefined;
  const message = job.state === 'submission_unknown' ? m.unknown
    : error ?? (failed ? errorLabels[language].provider_failed : undefined);
  const togglePanel = (panel: 'lyrics' | 'details') => setOpenPanel(current => current === panel ? null : panel);

  return <article className="flex w-full min-w-0 max-w-[26rem] flex-col gap-2 rounded-xl border border-edge bg-surface-panel p-3
    [background-image:radial-gradient(ellipse_at_top_left,var(--color-accent-soft),transparent_72%)] sm:p-3.5">
    <div className="flex items-center gap-2.5">
      <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-edge bg-surface-inset text-accent-fg" aria-hidden>
        <span className="absolute size-9 rounded-full border border-current opacity-15" />
        <span className="absolute size-6 rounded-full border border-current opacity-20" />
        <Music2 size={18} className="relative" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="wrap-anywhere text-lg leading-tight font-semibold tracking-tight text-fg">{job.title}</h3>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <span>{m[job.mode]} · {version}</span>
          {!completed && <span role="status" className="font-medium">{m.status[job.state]}</span>}
        </p>
      </div>
      <Button variant="ghost" className="size-11 shrink-0 rounded-full p-0 aria-expanded:bg-surface-active aria-expanded:text-fg"
        aria-label={m.details} title={m.details} aria-controls={`${id}-details`} aria-expanded={openPanel === 'details'}
        onClick={() => togglePanel('details')}>
        <Ellipsis size={20} aria-hidden />
      </Button>
    </div>
    {message && <p className={failed ? 'text-xs text-danger' : 'text-xs text-fg-muted'}>{message}</p>}
    {completed && <SpaceGeneratedMediaLink mediaId={`music-${job.id}.mp3`} title={job.title} zh={language === 'zh'} />}
    {completed && <MusicPlayer key={audioUrl} src={audioUrl} title={job.title} durationMs={job.durationMs}
      lyrics={job.mode === 'song' ? job.lyrics : null} lyricsOpen={openPanel === 'lyrics'}
      onToggleLyrics={() => togglePanel('lyrics')} language={language} />}
    <div id={`${id}-details`} hidden={openPanel !== 'details'} className="border-t border-edge pt-3">
      {openPanel === 'details' && <dl className="space-y-3">
        <div>
          <dt className="text-xs text-fg-muted">{m.prompt}</dt>
          <dd className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-fg">{job.prompt}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{m.model}</dt>
          <dd className="mt-1 wrap-anywhere text-sm text-fg">{job.modelRef}{job.errorCode === 'provider_rate_limited' && job.error?.endsWith('HTTP 429.') && ' · HTTP 429'}</dd>
        </div>
      </dl>}
    </div>
  </article>;
}
