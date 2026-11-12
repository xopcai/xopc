import type { MusicGenerationJob, MusicGenerationSession } from '@xopcai/gateway-contract';
import { Download, Music2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import useSWR from 'swr';

import type { ChatTimelineEntry } from '@/features/chat/messages/message-list';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type Language = 'en' | 'zh';

const labels = {
  zh: {
    song: '歌曲', instrumental: '纯音乐', lyrics: '查看歌词', download: '下载音频',
    status: { queued: '排队中', submitting: '正在提交', submitted: '供应商排队中', running: '生成中',
      saving: '正在保存', completed: '已完成', failed: '生成失败', submission_unknown: '暂时无法确认是否已生成' },
    unknown: '请先核对供应商的任务或账单，再决定是否重新生成。',
  },
  en: {
    song: 'Song', instrumental: 'Instrumental', lyrics: 'Show lyrics', download: 'Download audio',
    status: { queued: 'Queued', submitting: 'Submitting', submitted: 'Queued at provider', running: 'Generating',
      saving: 'Saving', completed: 'Ready', failed: 'Generation failed', submission_unknown: 'Submission unconfirmed' },
    unknown: 'Check the provider’s tasks or billing before generating again.',
  },
};

export function useChatMusicGeneration(conversationId: string | null, language: Language, chatBusy: boolean) {
  const url = conversationId ? apiUrl(`/api/music-generation/sessions/${encodeURIComponent(conversationId)}/jobs`) : null;
  const { data, mutate } = useSWR<MusicGenerationSession>(url, fetchJson<MusicGenerationSession>, {
    refreshInterval: latest => latest?.jobs.some(job => !['completed', 'failed', 'submission_unknown'].includes(job.state)) ? 3_000 : 0,
  });
  useEffect(() => {
    if (!chatBusy && url) void mutate();
  }, [chatBusy, mutate, url]);

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
      content: <MusicJobCard key={job.id} job={job} audioUrl={`${url}/${job.id}/audio`} language={language} />,
    }));
  }, [data, language, url]);
}

function MusicJobCard({ job, audioUrl, language }: { job: MusicGenerationJob; audioUrl: string; language: Language }) {
  const m = labels[language];
  const seconds = job.durationMs ? Math.round(job.durationMs / 1000) : null;
  const duration = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return <article className="mx-auto w-full max-w-lg space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
    <div className="flex items-start gap-2">
      <Music2 className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0">
        <h3 className="break-words text-sm font-medium text-fg">{job.title}</h3>
        <p className="text-xs text-fg-muted" aria-live="polite">
          {[m[job.mode], language === 'zh' ? `第 ${job.versionNumber} 版` : `Version ${job.versionNumber}`,
            job.state === 'completed' && duration ? duration : m.status[job.state]].join(' · ')}
        </p>
      </div>
    </div>
    {job.state === 'submission_unknown' ? <p className="text-xs text-fg-muted">{m.unknown}</p>
      : job.error && <p className="text-xs text-fg-muted">{job.error}</p>}
    {job.state === 'completed' && <>
      <audio controls preload="none" aria-label={job.title} src={audioUrl} className="w-full" />
      {job.lyrics && <details>
        <summary className="cursor-pointer text-sm text-fg-muted">{m.lyrics}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg">{job.lyrics}</p>
      </details>}
      <a href={`${audioUrl}?download=1`} download="music.mp3" className="inline-flex items-center gap-2 text-sm text-accent-fg hover:underline">
        <Download size={15} aria-hidden />{m.download}
      </a>
    </>}
  </article>;
}
