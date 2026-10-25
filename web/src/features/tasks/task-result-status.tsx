import type { TaskDetail } from './home-api';
import { summarizeTaskResult } from './task-detail-summary';

/** Execution, acceptance and delivery are independent facts. */
export function TaskResultStatus({ detail, language }: { detail: TaskDetail; language: 'zh' | 'en' }) {
  const result = summarizeTaskResult(detail);
  const zh = language === 'zh';
  const receiptLabel = result.receipt?.status === 'failed' ? (zh ? '最近一轮执行失败' : 'Latest run failed')
    : result.receipt?.status === 'cancelled' ? (zh ? '最近一轮执行已取消' : 'Latest run canceled')
    : result.receipt ? (zh ? '最近一轮执行已结束' : 'Latest run ended')
    : (zh ? '尚无本版任务的执行结果' : 'No run result for this task version');
  return <div className="mt-3 space-y-1 border-t border-edge-subtle pt-3 text-xs leading-5 text-fg-muted" aria-label={zh ? '执行、验收与交付' : 'Execution, acceptance and delivery'}>
    <p>{receiptLabel}{detail.task.phase !== 'closed' ? (zh ? '；任务仍未关闭' : '; task remains open') : ''}</p>
    <p>{zh ? `验收：${result.verified}/${result.criteria} 项通过` : `Acceptance: ${result.verified}/${result.criteria} criteria passed`}{result.criteria === 0 ? (zh ? '，尚未定义验收标准' : '; criteria not defined') : ''}</p>
    <p>{result.deliverables > 0
      ? (zh ? `已关联交付物：${result.deliverables} 项（不代表已验收）` : `Linked deliverables: ${result.deliverables} (acceptance is separate)`)
      : (zh ? '尚未关联正式交付物。对话中的文件或执行产物仍需检查并关联。' : 'No formal deliverables linked. Files in the conversation or run still need review and linking.')}</p>
  </div>;
}
