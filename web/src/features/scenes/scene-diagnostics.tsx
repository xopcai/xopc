import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { sceneGet } from './api';

export function SceneDiagnostics({ activationId, zh }: { activationId: string; zh: boolean }) {
  const diagnostics = useSWR<{ checksPaused: boolean; currentModel: string | null; pendingChecks: number; oldestDueWaitMs: number;
    activations: Array<{ id: string; status: string; next_deadline_check_at: number | null; retry_at: number | null; source_reason: string | null; source_attempt_at: number | null; source_failures: number | null; source_success_at: number | null; source_retry_at: number | null; last_check_at: number | null; next_schedule_at: number | null; deadline_at: number | null; last_reason: string | null }> }>('/diagnostics', sceneGet, { refreshInterval: 15000 });
  const row = diagnostics.data?.activations.find(item => item.id === activationId);
  if (!row) return null;
  const format = (time: number | null) => time == null ? (zh ? '未设置' : 'Not scheduled') : new Date(time).toLocaleString(zh ? 'zh-CN' : 'en');
  const reasons: Record<string, [string, string]> = {
    needs_permission: ['邮件授权已失效，请重新连接账号。', 'Mail permission expired. Reconnect the account.'],
    source_rate_limited: ['邮件服务暂时限流，将自动重试。', 'Mail service rate limited. A retry is scheduled.'],
    source_timeout: ['读取邮件超时，将自动重试。', 'Mail read timed out. A retry is scheduled.'],
    unchanged_result: ['资料未变化，已保留原成果和反馈。', 'Context unchanged. The existing result and feedback were preserved.'],
    source_not_ready: ['来源暂不可用，请检查连接授权；稍后会重试。', 'Source unavailable. Check connection access; a retry is scheduled.'],
    daily_budget: ['已达每日模型调用上限，将在预算恢复后继续。', 'Daily model limit reached. Checks resume after the budget resets.'],
    execution_failed: ['检查失败，请检查模型凭据和服务连接，再点“现在检查”。', 'Check failed. Verify model credentials and connectivity, then check again.'],
    invalid_model_result: ['模型返回的格式不符合这项关注的要求，结果未发布；请重试或更换模型。', 'The model returned an unsupported result for this monitor. Nothing was published; retry or choose another model.'],
    empty_input: ['请先填写安排和约束。', 'Provide arrangements and constraints first.'],
    source_changed: ['来源已变化，旧草稿未发布；可重新检查。', 'Source changed. The stale draft was withheld; check again.'],
    execution_aborted: ['检查已中断，可在服务恢复后重新检查。', 'Check interrupted. Retry after the service resumes.'],
  };
  const nextCheck = [row.next_schedule_at, row.next_deadline_check_at, row.retry_at].filter((value): value is number => value != null);
  const reason = row.source_reason ?? row.last_reason;
  return <section className="space-y-2 rounded-xl border border-edge p-4 text-sm text-fg-muted">
    <p>{zh ? '最近发起检查' : 'Last check started'}: {row.last_check_at == null ? (zh ? '尚未检查' : 'Not checked yet') : format(row.last_check_at)}</p>
    <p>{zh ? '下次定时检查' : 'Next scheduled check'}: {row.status !== 'active' || diagnostics.data?.checksPaused ? (zh ? '当前不会自动检查' : 'Automatic checks inactive') : nextCheck.length ? `${Math.min(...nextCheck) <= Date.now() ? (zh ? '等待执行，原定 ' : 'Pending, scheduled for ') : ''}${format(Math.min(...nextCheck))}` : (zh ? '暂无待执行检查' : 'No check scheduled')}</p>
    {row.deadline_at != null && <p>{zh ? '邮件跟进截止时间' : 'Mail follow-up deadline'}: {format(row.deadline_at)}</p>}
    {row.source_reason && row.source_attempt_at != null && <p>{zh ? '最近尝试读取邮件' : 'Last mail read attempt'}: {format(row.source_attempt_at)} · {zh ? '连续失败' : 'Consecutive failures'}: {row.source_failures}</p>}
    {row.source_reason && <Link to="/capabilities/connectors" className="inline-block text-accent underline">{zh ? '检查连接授权' : 'Check connection access'}</Link>}
    {row.source_success_at != null && <p>{zh ? '最近成功读取邮件' : 'Last successful mail read'}: {format(row.source_success_at)}</p>}
    {reason && reasons[reason] && <p role="status">{reasons[reason][zh ? 0 : 1]}</p>}
    <p>{zh ? '当前关注使用的模型' : 'Current monitor model'}: {diagnostics.data!.currentModel ?? (zh ? '配置不可用' : 'Configuration unavailable')}</p>
    {row.source_reason && row.status === 'active' && !diagnostics.data?.checksPaused && row.source_retry_at != null && <p>{zh ? '来源重试时间' : 'Source retry'}: {format(row.source_retry_at)}</p>}
    <p>{zh ? '所有智能关注待检查' : 'Pending checks across monitors'}: {diagnostics.data!.pendingChecks}</p>
  </section>;
}
