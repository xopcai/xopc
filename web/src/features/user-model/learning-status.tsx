import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type LearningStatus = {
  jobs: Array<{ state: string; errorCode?: string; count: number }>;
  coverage: Array<{ recordClass: string; status: string; verification: string; count: number }>;
};

export function LearningStatus({ language }: { language: 'en' | 'zh' }) {
  const { data, error, isLoading } = useSWR<LearningStatus>('memory-learning-status',
    () => fetchJson(apiUrl('/api/memory-learning/status')), { refreshInterval: 15_000 });
  if (isLoading) return <Skeleton className="h-14 w-full rounded-xl" />;
  if (error || !data?.jobs || !data?.coverage) return null;
  const pending = data.jobs.filter(job => ['queued', 'running', 'retry_wait'].includes(job.state)).reduce((sum, job) => sum + job.count, 0);
  const active = data.coverage.filter(item => item.recordClass === 'memory' && item.status === 'active' && item.verification === 'supported')
    .reduce((sum, item) => sum + item.count, 0);
  const indexed = data.coverage.filter(item => item.recordClass === 'source_index').reduce((sum, item) => sum + item.count, 0);
  const failed = data.jobs.filter(job => job.state === 'failed').reduce((sum, job) => sum + job.count, 0);
  const needsLocal = data.jobs.filter(job => job.errorCode === 'local_model_required').reduce((sum, job) => sum + job.count, 0);
  return <div className="rounded-xl border border-edge bg-surface-base px-4 py-3 text-sm text-fg-muted" role="status">
    {language === 'zh' ? `已索引资料 ${indexed} 条 · 已启用且有依据的工作记忆 ${active} 条 · ${pending} 项正在处理`
      : `${indexed} indexed sources · ${active} active, supported work memories · ${pending} learning jobs pending`}
    <p className="mt-1 text-xs">{language === 'zh' ? '此处统计已启用且有依据的记忆；管理列表包含其他状态。“关于你”单独统计个人偏好与信息，不等于工作资料数。' : 'This count includes active, supported memories. Management lists include other states. About you counts personal preferences and facts separately from work materials.'}</p>
    {failed > 0 ? <span className="ml-2">{language === 'zh' ? `${failed} 项处理失败` : `${failed} failed jobs`}</span> : null}
    {needsLocal > 0 ? <span className="ml-2">{language === 'zh' ? `${needsLocal} 项等待配置本地模型` : `${needsLocal} jobs require a local model`}</span> : null}
  </div>;
}
