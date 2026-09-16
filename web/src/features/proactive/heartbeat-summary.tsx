import { Link } from 'react-router-dom';

import type { HeartbeatOverview } from './api';
import { formatAssistantDate } from './presentation';

export function HeartbeatSummary({ value, zh }: { value: HeartbeatOverview; zh: boolean }) {
  const labels: Record<string, [string, string]> = {
    running: ['检查中', 'Checking'], prepared: ['有新的巡查结果', 'Result prepared'], no_change: ['没有需要提醒的新变化', 'No actionable changes'],
    empty_checklist: ['尚未安排巡查内容', 'Checklist is empty'], blocked: ['清单不可用，请检查设置', 'Check the checklist settings'],
    failed: ['检查失败，请查看日志', 'Check failed; see logs'], cancelled: ['本次检查已停止', 'Check stopped'], interrupted: ['检查被中断', 'Check interrupted'],
    pending: ['等待提醒时段或额度', 'Waiting for delivery window or budget'], queued: ['已加入渠道发送队列', 'Queued to the channel'],
    unknown: ['投递状态待核对，不会自动重发', 'Delivery unknown; will not resend automatically'], duplicate: ['已存在相同提醒', 'Duplicate suppressed'],
    no_target: ['结果已保存，未配置外部提醒', 'Saved here; no external destination'], expired: ['提醒已过期', 'Notification expired'],
  };
  const label = (key: string) => labels[key]?.[zh ? 0 : 1] ?? key;
  return <section className="rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="flex justify-between"><h2 className="font-semibold">{zh ? '日常巡查' : 'Heartbeat checks'}</h2><Link to="/settings/heartbeat" className="text-sm text-accent">{zh ? '清单与设置' : 'Checklist and settings'}</Link></div>
    <p className="mt-2 text-sm text-fg-muted">{!value.enabled ? (zh ? '未启用' : 'Disabled') : !value.checksAllowed ? (zh ? '自动检查已暂停' : 'Checks paused') : value.nextCheckAt ? `${zh ? '下次计划（活动时段内执行）' : 'Next scheduled check (during active hours)'}：${formatAssistantDate(value.nextCheckAt, zh)}` : (zh ? '等待检查' : 'Waiting')}</p>
    {value.recent.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer">{label(value.recent[0].status)} · {formatAssistantDate(value.recent[0].startedAt, zh)}</summary><div className="mt-3 max-h-96 space-y-4 overflow-y-auto">{value.recent.map(check => <div key={check.id} className="border-t border-edge pt-3"><p>{formatAssistantDate(check.startedAt, zh)} · {label(check.status)}</p>{check.deliveryStatus !== 'none' && <p className="mt-1 text-fg-muted">{label(check.deliveryStatus)}</p>}{check.target && <p className="text-xs text-fg-muted">{check.target} · {check.chatId}</p>}{check.content && <p className="mt-2 whitespace-pre-wrap">{check.content}</p>}</div>)}</div></details>}
  </section>;
}
