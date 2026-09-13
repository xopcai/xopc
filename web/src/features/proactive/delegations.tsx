import type { ProactiveCard } from '@xopcai/gateway-contract';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { newChatAutoSendHref } from '@/features/chat/session/composer-handoff-params';

import { proactiveGet, proactiveWrite, type Delegation, type DelegationRun, type ProactiveTemplate } from './api';
import { proactiveCopy } from './copy';
import { MailFollowUpService } from './mail-follow-ups';
import {
  delegationNextTrigger,
  delegationState,
  delegationTitle,
  formatAssistantDate,
  latestCardSummary,
  runProgressLabel,
} from './presentation';
import { ProactiveCardView } from './proactive-card';

const field = 'mt-2 w-full rounded-lg border border-edge bg-surface-base p-3 text-sm text-fg';

export function DelegationListItem({ sub, card, zh }: { sub: Delegation; card?: ProactiveCard; zh: boolean }) {
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="flex items-start justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="font-semibold text-fg">{delegationTitle(sub, zh)}</h2><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-fg-muted">{sub.userInstructions}</p></div><Link className="shrink-0 text-sm font-medium text-accent" to={`/assistant-work?delegation=${encodeURIComponent(sub.id)}`}>{zh ? '查看' : 'View'}</Link></div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-fg-subtle">{zh ? '当前状态' : 'Current state'}</dt><dd className="mt-1 text-fg">{delegationState(sub, zh)}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '接下来' : 'Next'}</dt><dd className="mt-1 text-fg">{delegationNextTrigger(sub, zh)}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '最新成果或决定' : 'Latest result or decision'}</dt><dd className="mt-1 text-fg">{latestCardSummary(card, zh)}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '最近核对' : 'Last checked'}</dt><dd className="mt-1 text-fg">{sub.latestRun?.completedAt ? formatAssistantDate(sub.latestRun.completedAt, zh) : (zh ? '尚未完成首次核对' : 'First check has not completed')}</dd></div></dl>
  </article>;
}

export function DelegationDetail({ sub, card, zh, refresh }: { sub: Delegation; card?: ProactiveCard; zh: boolean; refresh: () => void }) {
  const runs = useSWR<{ runs: DelegationRun[] }>(`/api/proactive/subscriptions/${encodeURIComponent(sub.id)}/runs`, proactiveGet, { revalidateOnFocus: false });
  const [tab, setTab] = useState<'latest' | 'progress' | 'requirements'>('latest');
  const [instructions, setInstructions] = useState(sub.userInstructions);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(patch: Record<string, unknown>, check = false) {
    setBusy(true); setError('');
    try { await proactiveWrite(`/api/proactive/subscriptions/${encodeURIComponent(sub.id)}${check ? '/check' : ''}`, check ? 'POST' : 'PATCH', check ? {} : { ...patch, expectedRevision: sub.revision }); setEditing(false); refresh(); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const tabs = [['latest', zh ? '最新成果' : 'Latest result'], ['progress', zh ? '进展记录' : 'Progress'], ['requirements', zh ? '关注要求' : 'Instructions']] as const;
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold text-fg">{delegationTitle(sub, zh)}</h1><p className="mt-2 text-sm text-fg-muted">{delegationState(sub, zh)}</p></div><nav className="flex gap-2" aria-label={zh ? '事项详情' : 'Work details'}>{tabs.map(([id, label]) => <Button key={id} variant={tab === id ? 'secondary' : 'ghost'} onClick={() => setTab(id)}>{label}</Button>)}</nav>
    {tab === 'latest' && (card ? <ProactiveCardView card={card} copy={proactiveCopy(zh)} refresh={refresh} detail /> : <section className="rounded-2xl border border-edge bg-surface-panel p-6"><h2 className="font-medium text-fg">{zh ? '还没有需要你处理的新成果' : 'No new result needs your attention'}</h2><p className="mt-2 text-sm text-fg-muted">{delegationNextTrigger(sub, zh)}</p></section>)}
    {tab === 'progress' && <section className="rounded-2xl border border-edge bg-surface-panel p-5"><dl className="space-y-4 text-sm"><div><dt className="text-fg-subtle">{zh ? '当前状态' : 'Current state'}</dt><dd className="mt-1 text-fg">{delegationState(sub, zh)}</dd></div><div><dt className="text-fg-subtle">{zh ? '接下来' : 'Next'}</dt><dd className="mt-1 text-fg">{delegationNextTrigger(sub, zh)}</dd></div></dl><div className="mt-5 border-t border-edge pt-4"><h2 className="text-sm font-medium text-fg">{zh ? '最近进展' : 'Recent progress'}</h2>{runs.isLoading ? <Skeleton className="mt-3 h-24 rounded-xl" /> : runs.data?.runs.length ? <ol className="mt-3 divide-y divide-edge-subtle">{runs.data.runs.map(run => <li key={run.id} className="py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-fg">{runProgressLabel(run.reason ?? run.status, zh)}</span><time className="text-xs text-fg-subtle" dateTime={run.completedAt ?? run.startedAt}>{formatAssistantDate(run.completedAt ?? run.startedAt, zh)}</time></div>{run.error && <p className="mt-1 text-danger">{run.error}</p>}</li>)}</ol> : <p className="mt-3 text-sm text-fg-muted">{zh ? '还没有完成第一次核对。' : 'The first check has not completed yet.'}</p>}{runs.error && <p className="mt-3 text-sm text-danger">{String(runs.error)}</p>}</div>{sub.project && <Link className="mt-4 inline-block text-sm text-accent" to={`/projects/${encodeURIComponent(sub.scopeId)}`}>{zh ? '打开相关项目' : 'Open related project'}</Link>}</section>}
    {tab === 'requirements' && <section className="rounded-2xl border border-edge bg-surface-panel p-5"><p className="whitespace-pre-wrap text-sm text-fg">{sub.userInstructions}</p>{editing && <label className="mt-4 block text-sm">{zh ? '希望我关注什么，忽略什么？' : 'What should I follow or ignore?'}<textarea rows={5} maxLength={12000} className={field} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>}{!sub.completedAt && <div className="mt-5 flex flex-wrap gap-2">{editing ? <><Button disabled={busy || !instructions.trim()} onClick={() => void change({ userInstructions: instructions })}>{zh ? '保存要求' : 'Save instructions'}</Button><Button variant="ghost" onClick={() => setEditing(false)}>{zh ? '取消' : 'Cancel'}</Button></> : <Button variant="ghost" onClick={() => setEditing(true)}>{zh ? '调整要求' : 'Adjust instructions'}</Button>}<Button variant="ghost" disabled={busy} onClick={() => void change({ enabled: !sub.enabled })}>{sub.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</Button>{sub.scopeKind === 'project' && sub.enabled && <Button variant="ghost" disabled={busy || sub.pending} onClick={() => void change({}, true)}>{zh ? '现在核对' : 'Check now'}</Button>}<Button variant="ghost" disabled={busy} onClick={() => void change({ enabled: false, completedAt: new Date().toISOString() })}>{zh ? '结束这件事' : 'End this work'}</Button></div>}</section>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}

export function DelegationServices({ zh, onStarted, projectId }: { zh: boolean; onStarted: () => void; projectId?: string }) {
  const templates = useSWR<{ templates: ProactiveTemplate[] }>('/api/proactive/templates', proactiveGet);
  const projects = useSWR<{ items: Array<{ id: string; name: string }> }>('/api/projects?limit=200', proactiveGet);
  const [intent, setIntent] = useState('');
  const [selected, setSelected] = useState<string | null>(projectId ? 'project_delivery_risk' : null);
  const [project, setProject] = useState(projectId ?? '');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() { setBusy(true); setError(''); try { await proactiveWrite('/api/proactive/delegations', 'POST', { scenarioKey: selected, ...(selected === 'project_delivery_risk' ? { projectId: project } : {}), instructions }); onStarted(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }
  if (templates.isLoading || projects.isLoading) return <Skeleton className="h-52 rounded-2xl" />;
  const suggestions: Record<string, [string, string]> = { project_delivery_risk: [zh ? '盯住项目交付' : 'Follow project delivery', zh ? '关注阻塞和承诺，提前准备处理清单。' : 'Watch blockers and commitments, then prepare a useful checklist.'], meeting_preparation: [zh ? '开会前替我准备' : 'Prepare me for meetings', zh ? '整理目标、资料和需要决定的问题。' : 'Prepare goals, context, and decisions before meetings.'], communication_follow_up: [zh ? '替我跟进一封邮件' : 'Follow an email for me', zh ? '等回复，整理变化，到时间准备跟进草稿。' : 'Watch for replies and prepare a draft when it is time.'] };
  const handoff = intent.trim() ? newChatAutoSendHref(`${intent.trim()}\n\n${zh ? '请把这件事作为持续跟进的事项记住，并先和我确认目标、范围与提醒方式。' : 'Remember this as delegated work and first confirm the goal, scope, and notification preference with me.'}`, undefined, { projectScope: 'none' }) : null;
  return <div className="space-y-6"><section className="rounded-2xl border border-edge bg-surface-panel p-5"><h2 className="text-lg font-semibold text-fg">{zh ? '想让我持续替你做什么？' : 'What should I keep doing for you?'}</h2><p className="mt-1 text-sm text-fg-muted">{zh ? '直接说目标。助理会在对话中确认范围，再开始跟进。' : 'Describe the outcome. The assistant will confirm the scope in chat before following it.'}</p><textarea className={field} rows={4} value={intent} onChange={e => setIntent(e.target.value)} placeholder={zh ? '例如：帮我盯住官网改版，发现会影响月底上线的问题就告诉我，并提前准备解决方案。' : 'For example: watch the website redesign and tell me about anything that threatens the launch, with a proposed fix.'} />{handoff && <Button asChild variant="primary" className="mt-3"><Link to={handoff}>{zh ? '交给助理' : 'Delegate to assistant'}</Link></Button>}</section>
    <section><h2 className="mb-3 text-sm font-medium text-fg-muted">{zh ? '也可以从这些常见事项开始' : 'Or start with a common request'}</h2><div className="grid gap-3 md:grid-cols-3">{Object.entries(suggestions).map(([key, [title, description]]) => <button key={key} type="button" className={`rounded-2xl border p-4 text-left transition-colors ${selected === key ? 'border-accent bg-accent-soft' : 'border-edge bg-surface-panel hover:bg-surface-hover'}`} onClick={() => { setSelected(key); setInstructions(description); }}><span className="font-medium text-fg">{title}</span><span className="mt-2 block text-sm text-fg-muted">{description}</span></button>)}</div></section>
    {selected === 'communication_follow_up' && <MailFollowUpService zh={zh} onStarted={onStarted} open onOpen={() => {}} />}
    {selected && selected !== 'communication_follow_up' && <section className="rounded-2xl border border-edge bg-surface-panel p-5"><h2 className="font-medium text-fg">{suggestions[selected]?.[0]}</h2>{selected === 'project_delivery_risk' && <label className="mt-4 block text-sm">{zh ? '关注哪个项目' : 'Which project'}<Select value={project} onChange={e => setProject(e.target.value)}><SelectOption value="">{zh ? '选择项目' : 'Choose project'}</SelectOption>{projects.data?.items.map(p => <SelectOption key={p.id} value={p.id}>{p.name}</SelectOption>)}</Select></label>}<label className="mt-4 block text-sm">{zh ? '希望跟进到什么结果？' : 'What outcome should I follow through to?'}<textarea rows={4} className={field} maxLength={12000} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>{selected === 'meeting_preparation' && templates.data?.templates.find(t => t.key === selected)?.calendarSource?.status !== 'available' && <p className="mt-3 text-sm text-fg-muted">{zh ? '还没有可用的日历资料。' : 'Calendar context is not available yet.'} <Link className="text-accent" to="/connectors">{zh ? '连接日历' : 'Connect a calendar'}</Link></p>}<Button className="mt-4" variant="primary" disabled={busy || !instructions.trim() || (selected === 'project_delivery_risk' && !project)} onClick={() => void start()}>{zh ? '开始跟进' : 'Start following'}</Button></section>}
    {(error || templates.error || projects.error) && <p role="alert" className="text-sm text-danger">{error || String(templates.error ?? projects.error)}</p>}</div>;
}
