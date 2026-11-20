import { taskRunResultKind } from '@xopcai/gateway-contract';

import type { TaskDetail } from './home-api';
import { taskCopy } from './task-copy';
import { summarizeTaskResult } from './task-detail-summary';

/** Execution, acceptance and delivery are independent facts. */
export function TaskResultStatus({ detail, language }: { detail: TaskDetail; language: 'zh' | 'en' }) {
  const result = summarizeTaskResult(detail);
  const zh = language === 'zh';
  const receiptLabel = result.receipt
    ? taskCopy(language).resultStatuses[taskRunResultKind(result.receipt)]
    : zh ? '尚无本版任务的执行结果' : 'No run result for this task version';
  return <div className="mt-3 space-y-1 border-t border-edge-subtle pt-3 text-xs leading-5 text-fg-muted" aria-label={zh ? '执行、验收与交付' : 'Execution, acceptance and delivery'}>
    <p>{receiptLabel}{detail.task.phase !== 'closed' ? (zh ? '；任务仍未关闭' : '; task remains open') : ''}</p>
    <p>{zh ? `验收：${result.verified}/${result.criteria} 项通过` : `Acceptance: ${result.verified}/${result.criteria} criteria passed`}{result.criteria === 0 ? (zh ? '，尚未定义验收标准' : '; criteria not defined') : ''}</p>
    <p>{result.deliverables > 0
      ? (zh ? `已关联交付物：${result.deliverables} 项` : `Linked deliverables: ${result.deliverables}`)
      : (zh ? '尚无正式交付物' : 'No formal deliverables linked')}</p>
  </div>;
}
