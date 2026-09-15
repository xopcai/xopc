import type { MonitoringMode, ProactiveCard } from '@xopcai/gateway-contract';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { updateProjectMonitoring } from '@/features/projects/api';

import { proactiveWrite, type Delegation } from './api';
import { proactiveCopy } from './copy';
import { delegationNextTrigger, delegationState, delegationTitle, latestCardSummary } from './presentation';
import { ProactiveCardView } from './proactive-card';

const field = 'mt-2 w-full rounded-lg border border-edge bg-surface-base p-3 text-sm text-fg';

export function DelegationListItem({ sub, card, zh }: { sub: Delegation; card?: ProactiveCard; zh: boolean }) {
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1"><h2 className="font-semibold text-fg">{delegationTitle(sub, zh)}</h2><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-fg-muted">{sub.userInstructions}</p></div>
      <Link className="shrink-0 text-sm font-medium text-accent" to={`/assistant-work?delegation=${encodeURIComponent(sub.id)}`}>{zh ? '调整' : 'Adjust'}</Link>
    </div>
    <div className="mt-4 rounded-xl bg-surface-hover px-4 py-3 text-sm"><p className="font-medium text-fg">{delegationState(sub, zh, card)}</p><p className="mt-1 text-fg-muted">{latestCardSummary(card, zh)}</p></div>
  </article>;
}

export function DelegationDetail({ sub, card, zh, refresh }: { sub: Delegation; card?: ProactiveCard; zh: boolean; refresh: () => void }) {
  const [instructions, setInstructions] = useState(sub.userInstructions);
  const [delivery, setDelivery] = useState(sub.delivery);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  async function change(patch: Record<string, unknown>, check = false) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await proactiveWrite(`/api/proactive/subscriptions/${encodeURIComponent(sub.id)}${check ? '/check' : ''}`, check ? 'POST' : 'PATCH', check ? {} : { ...patch, expectedRevision: sub.revision });
      setEditing(false);
      setNotice(check ? (zh ? '助理正在重新看看这个项目。' : 'Your assistant is checking the project again.') : (zh ? '助理跟进已更新。' : 'Assistant follow-up updated.'));
      refresh();
    } catch (cause) { setError(String(cause)); refresh(); } finally { setBusy(false); }
  }
  async function changeActionMode(mode: MonitoringMode) {
    if (actionBusy || !sub.project) return;
    setActionBusy(true); setError(''); setNotice('');
    try {
      await updateProjectMonitoring(sub.scopeId, { mode, allowedActions: mode === 'auto_low_risk' ? ['create_project_task'] : [] });
      setNotice(zh ? '行动边界已更新。' : 'Action boundary updated.');
      refresh();
    } catch (cause) { setError(String(cause)); refresh(); } finally { setActionBusy(false); }
  }
  const when = sub.scopeKind === 'project'
    ? (zh ? '项目目标、承诺或交付风险出现有意义的变化时' : 'When the project goal, commitments, or delivery risk meaningfully changes')
    : sub.scenarioKey === 'meeting_preparation'
      ? (zh ? '相关会议临近，或会议资料发生变化时' : 'When a relevant meeting approaches or its context changes')
      : (zh ? '相关沟通出现值得你接手的变化时' : 'When a conversation changes in a way that needs you');
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold text-fg">{delegationTitle(sub, zh)}</h1><p className="mt-2 text-sm text-fg-muted">{delegationState(sub, zh, card)}</p></div>
    {!sub.completedAt && <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void change({ enabled: !sub.enabled })}>{sub.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</Button>{sub.scopeKind === 'project' && <Button variant="ghost" disabled={busy || sub.checking || !sub.effectiveEnabled} onClick={() => void change({}, true)}>{zh ? '现在再看看' : 'Check again now'}</Button>}</div>}
    {notice && <p role="status" className="text-sm text-fg-muted">{notice}</p>}
    {card && <ProactiveCardView card={card} copy={proactiveCopy(zh)} refresh={refresh} detail />}
    <section className="rounded-2xl border border-edge bg-surface-panel p-5">
      <h2 className="font-semibold text-fg">{zh ? '跟进要求' : 'What your assistant remembers'}</h2>
      <dl className="mt-4 space-y-4 text-sm"><div><dt className="text-xs text-fg-subtle">{zh ? '要帮你守住什么' : 'What to protect'}</dt><dd className="mt-1 whitespace-pre-wrap text-fg">{sub.userInstructions}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '什么时候回来找你' : 'When to come back'}</dt><dd className="mt-1 text-fg">{when}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '接下来' : 'Next'}</dt><dd className="mt-1 text-fg">{delegationNextTrigger(sub, zh)}</dd></div></dl>
      {sub.projectMonitoring && !sub.completedAt && <label className="mt-5 block border-t border-edge pt-5 text-sm"><span className="font-medium text-fg">{zh ? '助理可以做到哪里' : 'How far the assistant can go'}</span><Select disabled={actionBusy} value={sub.projectMonitoring.mode} onChange={event => void changeActionMode(event.target.value as MonitoringMode)}><SelectOption value="observe">{zh ? '只观察和整理' : 'Observe and organize only'}</SelectOption><SelectOption value="ask_before_action">{zh ? '先准备，行动前问我' : 'Prepare first, ask before acting'}</SelectOption><SelectOption value="auto_low_risk">{zh ? '自动完成明确的低风险动作' : 'Complete explicit low-risk actions'}</SelectOption></Select><span className="mt-2 block text-xs text-fg-muted">{sub.projectMonitoring.mode === 'auto_low_risk' ? (zh ? '目前只包括在当前项目中创建可撤销的待办。' : 'Currently limited to creating reversible tasks in this project.') : (zh ? '涉及外部发送或不可逆操作时仍会询问你。' : 'External sends and irreversible actions still require you.')}</span></label>}
      {editing && <div className="mt-5 border-t border-edge pt-5"><label className="block text-sm">{zh ? '希望助理关注什么，忽略什么？' : 'What should the assistant follow or ignore?'}<textarea rows={5} maxLength={12000} className={field} value={instructions} onChange={event => setInstructions(event.target.value)} /></label><label className="mt-4 block text-sm">{zh ? '什么时候提醒我' : 'When to notify me'}<Select value={delivery} onChange={event => setDelivery(event.target.value as typeof delivery)}><SelectOption value="inbox">{zh ? '回到工作台时告诉我' : 'Tell me in the Workbench'}</SelectOption><SelectOption value="important">{zh ? '重要变化立即告诉我' : 'Tell me right away for important changes'}</SelectOption><SelectOption value="digest">{zh ? '放进每日汇总' : 'Include it in my daily digest'}</SelectOption></Select></label></div>}
      {!sub.completedAt && <div className="mt-5 flex flex-wrap gap-2">{editing ? <><Button disabled={busy || !instructions.trim()} onClick={() => void change({ userInstructions: instructions, delivery })}>{zh ? '保存安排' : 'Save arrangement'}</Button><Button variant="ghost" onClick={() => setEditing(false)}>{zh ? '取消' : 'Cancel'}</Button></> : <Button variant="ghost" onClick={() => setEditing(true)}>{zh ? '调整安排' : 'Adjust arrangement'}</Button>}<Button variant="ghost" disabled={busy} onClick={() => void change({ enabled: false, completedAt: new Date().toISOString() })}>{zh ? '结束安排' : 'End arrangement'}</Button></div>}
      {sub.project && <Link className="mt-4 inline-block text-sm text-accent" to={`/projects/${encodeURIComponent(sub.scopeId)}`}>{zh ? '回到项目' : 'Back to project'}</Link>}
    </section>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
