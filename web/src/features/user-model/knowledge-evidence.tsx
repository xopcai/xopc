import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type EvidenceResponse = {
  evidence: Array<{ sourceType: string; observedAt: number; excerpt?: string }>;
  reviewSuggestion?: 'collaboration_rule' | 'global_collaboration_rule';
};

export function KnowledgeEvidence({ id, version, language }: { id: string; version?: string; language: 'en' | 'zh' }) {
  const { data, error, isLoading } = useSWR<EvidenceResponse>(
    ['knowledge-evidence', id, version], () => fetchJson<EvidenceResponse>(apiUrl(`/api/knowledge-memory/${encodeURIComponent(id)}/evidence`)));
  if (isLoading) return <Skeleton className="mt-3 h-10 w-full rounded-lg" />;
  if (error) return <p className="mt-3 text-xs text-fg-muted">{language === 'zh'
    ? '此条证据目前不可用于回答，请检查来源授权、有效期和读取范围。'
    : 'Evidence is currently unavailable. Check source authorization, validity and read scope.'}</p>;
  if (!data?.evidence.length && !data?.reviewSuggestion) return null;
  return <div className="mt-3 space-y-2 border-t border-edge-subtle pt-3 text-xs text-fg-muted">
    {data?.reviewSuggestion ? <p>
      {data.reviewSuggestion === 'global_collaboration_rule'
        ? language === 'zh' ? '原始指令明确适用于所有协作。可在聊天中将工具偏好记为全局协作规则。'
          : 'The original instruction applies across projects. In chat, ask to remember the tool preference for all work.'
        : language === 'zh' ? '原始指令是长期工具偏好。可在聊天中按原指令的范围记为协作规则。'
          : 'The original instruction is a standing tool preference. In chat, ask to remember it with the original scope.'}
    </p> : null}
    {data?.evidence.map((evidence, index) => <p key={index}>
      {language === 'zh' ? '证据' : 'Evidence'} · {evidence.sourceType === 'conversation'
        ? language === 'zh' ? '对话' : 'Conversation'
        : evidence.sourceType === 'runtime' ? language === 'zh' ? '执行记录' : 'Execution receipt'
          : language === 'zh' ? '授权资料' : 'Authorized source'} · {new Date(evidence.observedAt).toLocaleDateString(language)}
      {evidence.excerpt ? <span className="mt-1 block whitespace-pre-wrap break-words">{evidence.excerpt}</span> : null}
    </p>)}
  </div>;
}
