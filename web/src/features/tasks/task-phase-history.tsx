import type { TaskPhaseChange } from '@xopcai/gateway-contract';

import { formatMediumDateTime } from '@/lib/date-formatters';

export function TaskPhaseHistory({ changes, language }: { changes: TaskPhaseChange[]; language: 'en' | 'zh' }) {
  const zh = language === 'zh';
  const phases = zh
    ? { backlog: '待办池', ready: '就绪', active: '进行中', review: '待验收', closed: '已关闭' }
    : { backlog: 'Backlog', ready: 'Ready', active: 'Active', review: 'Review', closed: 'Closed' };
  const sources = zh ? { board: '看板', mobile: '移动端', api: '手动操作', runtime: '自动流转', undo: '撤销' }
    : { board: 'Board', mobile: 'Mobile', api: 'Manual update', runtime: 'Automatic', undo: 'Undo' };
  const resolutions = zh ? { done: '完成', cancelled: '取消', duplicate: '重复', wont_do: '不做' }
    : { done: 'Done', cancelled: 'Cancelled', duplicate: 'Duplicate', wont_do: 'Won’t do' };
  const actors = zh ? { user: '用户', agent: 'Agent', system: '系统', integration: '外部服务' }
    : { user: 'User', agent: 'Agent', system: 'System', integration: 'Integration' };
  return <details className="rounded-xl border border-edge bg-surface-panel p-4">
    <summary className="cursor-pointer text-sm font-semibold text-fg">{zh ? '变更记录' : 'Change log'} ({changes.length})</summary>
    <ol className="mt-3 max-h-80 space-y-3 overflow-y-auto">
      {[...changes].reverse().map(change => <li key={change.id} className="text-sm text-fg">
        <div>{phases[change.fromPhase]}{change.fromResolution ? ` · ${resolutions[change.fromResolution]}` : ''} → {phases[change.toPhase]}
          {change.toResolution ? ` · ${resolutions[change.toResolution]}` : ''}</div>
        <div className="mt-1 text-xs text-fg-muted">
          {actors[change.actor.kind]}
          {change.actor.id ? ` (${change.actor.id})` : ''} · {sources[change.source]} · <time dateTime={new Date(change.createdAt).toISOString()}>{formatMediumDateTime(change.createdAt, language)}</time>
        </div>
      </li>)}
    </ol>
    {!changes.length ? <p className="mt-3 text-xs text-fg-muted">{zh ? '暂无阶段变更记录' : 'No phase changes yet'}</p> : null}
  </details>;
}
