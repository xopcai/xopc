import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';

import { proactiveGet, proactiveWrite, type Delegation, type ProactiveTemplate } from './api';
import { MailFollowUpService } from './mail-follow-ups';
import { localizedTemplate, runLabel } from './copy';

const field = 'mt-2 w-full rounded-lg border border-edge bg-surface-base p-3 text-sm text-fg';

export function DelegationView({ sub, zh, refresh }: { sub: Delegation; zh: boolean; refresh: () => void }) {
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
  const title = sub.project?.name ?? localizedTemplate(sub.scenarioKey, { title: sub.scenarioKey === 'communication_follow_up' ? 'Email follow-up' : sub.scenarioKey, description: '' }, zh ? 'zh' : 'en').title;
  return <article id={sub.id} className="rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="flex flex-wrap justify-between gap-2"><h2 className="font-medium text-fg">{title}</h2><span className="text-xs text-fg-muted">{sub.completedAt ? (zh ? '已结束' : 'Ended') : sub.effectiveEnabled ? (zh ? '正在关注' : 'Following') : (zh ? '已暂停' : 'Paused')}</span></div>
    <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{sub.userInstructions}</p>
    <p className="mt-3 text-sm text-fg">{sub.pending ? (zh ? '正在检查最新情况' : 'Checking current work') : sub.latestRun ? runLabel(sub.latestRun.reason ?? sub.latestRun.status, zh ? 'zh' : 'en') : (zh ? '等待相关资料或事件' : 'Waiting for relevant sources or events')}</p>
    {sub.latestRun?.completedAt && <p className="mt-1 text-xs text-fg-muted">{zh ? '最近检查完成：' : 'Last completed check: '}{new Date(sub.latestRun.completedAt).toLocaleString()}</p>}
    {sub.latestRun?.error && <p className="mt-2 text-sm text-danger">{sub.latestRun.error}</p>}
    <p className="mt-3 text-xs text-fg-muted">{zh ? '准备清单和草稿；修改遵循项目授权，默认先确认。' : 'Prepares checklists and drafts. Changes follow project permissions and require approval by default.'}</p>
    {sub.project && <Link className="mt-2 block text-sm text-accent" to={`/projects/${encodeURIComponent(sub.scopeId)}`}>{zh ? '打开项目及进展' : 'Open project progress'}</Link>}
    {editing && <label className="mt-3 block text-sm">{zh ? '希望我关注什么，忽略什么？' : 'What should I follow or ignore?'}<textarea rows={4} maxLength={12000} className={field} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>}
    {!sub.completedAt && <div className="mt-4 flex flex-wrap gap-2">{editing ? <Button disabled={busy} onClick={() => void change({ userInstructions: instructions })}>{zh ? '记住这个要求' : 'Save instructions'}</Button> : <Button variant="ghost" onClick={() => setEditing(true)}>{zh ? '调整关注要求' : 'Adjust instructions'}</Button>}<Button variant="ghost" disabled={busy} onClick={() => void change({ enabled: !sub.enabled })}>{sub.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</Button>{sub.scopeKind === 'project' && sub.enabled && <Button variant="ghost" disabled={busy || sub.pending} onClick={() => void change({}, true)}>{zh ? '现在检查' : 'Check now'}</Button>}<Button variant="ghost" disabled={busy} onClick={() => void change({ enabled: false, completedAt: new Date().toISOString() })}>{zh ? '结束关注' : 'End delegation'}</Button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </article>;
}

export function DelegationServices({ zh, onStarted, projectId }: { zh: boolean; onStarted: () => void; projectId?: string }) {
  const templates = useSWR<{ templates: ProactiveTemplate[] }>('/api/proactive/templates', proactiveGet);
  const projects = useSWR<{ items: Array<{ id: string; name: string }> }>('/api/projects?limit=200', proactiveGet);
  const [selected, setSelected] = useState<string | null>(projectId ? 'project_delivery_risk' : null);
  const [project, setProject] = useState(projectId ?? '');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try { await proactiveWrite('/api/proactive/delegations', 'POST', { scenarioKey: selected, ...(selected === 'project_delivery_risk' ? { projectId: project } : {}), instructions }); onStarted(); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  if (templates.isLoading || projects.isLoading) return <Skeleton className="h-52" />;
  const names: Record<string, [string, string]> = { project_delivery_risk: [zh ? '盯住项目交付' : 'Follow project delivery', zh ? '关注交付的阻塞，提前准备处理清单。' : 'Watch delivery blockers and prepare a useful checklist.'], meeting_preparation: [zh ? '开会前替我准备' : 'Prepare me for meetings', zh ? '整理会议目标、相关资料和需要决定的问题。' : 'Prepare context, references and decisions before meetings.'], discussion_follow_up: [zh ? '把讨论的事跟进下去' : 'Follow through on discussions', zh ? '从讨论记录整理承诺和下一步草稿。' : 'Prepare commitments and next steps from discussion records.'] };
  return <div className="space-y-4"><MailFollowUpService zh={zh} onStarted={onStarted} open={selected === 'communication_follow_up'} onOpen={() => setSelected('communication_follow_up')} />{Object.entries(names).map(([key, [title, description]]) => <article key={key} className="rounded-2xl border border-edge bg-surface-panel p-5"><h2 className="font-medium">{title}</h2><p className="mt-2 text-sm text-fg-muted">{description}</p>{selected !== key ? <Button className="mt-3" onClick={() => { setSelected(key); setInstructions(description); }}>{zh ? '交代这件事' : 'Set this up'}</Button> : <div className="mt-4 space-y-3">
    {key === 'project_delivery_risk' && <label className="block text-sm">{zh ? '关注哪个项目' : 'Which project'}<Select value={project} onChange={e => setProject(e.target.value)}><SelectOption value="">{zh ? '选择项目' : 'Choose project'}</SelectOption>{projects.data?.items.map(p => <SelectOption key={p.id} value={p.id}>{p.name}</SelectOption>)}</Select></label>}
    <label className="block text-sm">{zh ? '你希望我怎么帮你？' : 'How should I help?'}<textarea rows={3} className={field} maxLength={12000} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
    <p className="text-xs text-fg-muted">{zh ? '我会查看所选范围的资料、准备成果。修改遵循项目授权，默认先确认。随时可以暂停。' : 'I will read the selected context and prepare useful work. Changes follow project permissions, with approval by default. You can pause anytime.'}</p>
    {key === 'meeting_preparation' && templates.data?.templates.find(t => t.key === key)?.calendarSource?.status !== 'available' && <p className="text-sm text-fg-muted">{zh ? '尚未获得可用的日历资料。' : 'Calendar context is not available yet.'} <Link className="text-accent" to="/connectors">{zh ? '连接并授权日历' : 'Connect a calendar'}</Link></p>}
    <Button variant="primary" disabled={busy || !instructions.trim() || (key === 'project_delivery_risk' && !project)} onClick={() => void start()}>{zh ? '交给你了' : 'Start following'}</Button>
  </div>}</article>)}{(error || templates.error || projects.error) && <p role="alert" className="text-sm text-danger">{error || String(templates.error ?? projects.error)}</p>}</div>;
}
