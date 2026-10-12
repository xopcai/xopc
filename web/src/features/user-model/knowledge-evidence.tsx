import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type EvidenceResponse = { evidence: Array<{ sourceType: string; observedAt: number; excerpt?: string }> };

export function KnowledgeEvidence({ id, language }: { id: string; language: 'en' | 'zh' }) {
  const { data, error, isLoading } = useSWR<EvidenceResponse>(
    `knowledge-evidence:${id}`, () => fetchJson<EvidenceResponse>(apiUrl(`/api/knowledge-memory/${encodeURIComponent(id)}/evidence`)));
  if (isLoading) return <Skeleton className="mt-3 h-10 w-full rounded-lg" />;
  if (error) return <p className="mt-3 text-xs text-fg-muted">{language === 'zh'
    ? '此条证据目前不可用于回答，请检查来源授权、有效期和读取范围。'
    : 'Evidence is currently unavailable. Check source authorization, validity and read scope.'}</p>;
  if (!Array.isArray(data?.evidence) || !data.evidence.length) return null;
  return <div className="mt-3 space-y-2 border-t border-edge-subtle pt-3 text-xs text-fg-muted">
    {data.evidence.map((evidence, index) => <p key={index}>
      {language === 'zh' ? '证据' : 'Evidence'} · {evidence.sourceType === 'conversation'
        ? language === 'zh' ? '对话' : 'Conversation'
        : evidence.sourceType === 'runtime' ? language === 'zh' ? '执行记录' : 'Execution receipt'
          : language === 'zh' ? '授权资料' : 'Authorized source'} · {new Date(evidence.observedAt).toLocaleDateString(language)}
      {evidence.excerpt ? <span className="mt-1 block whitespace-pre-wrap break-words">{evidence.excerpt}</span> : null}
    </p>)}
  </div>;
}
