import { useState } from 'react';
import { HomeOpportunityActionResponseSchema, ObservationStateSchema, type HomeAdvisor, type ObservationState, type ObservationCommandRequest } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { HomeTaskReview } from './home-task-review';
import { RoutineAdoption, RoutinePanel } from './routine-panel';

export function HomeObservationCard({ observation, advisor, language, onUpdated }: {
  observation: ObservationState; advisor: HomeAdvisor; language: 'zh' | 'en'; onUpdated(): void;
}) {
  const zh = language === 'zh';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'once' | 'project' | 'similar'>('once');
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [journal, setJournal] = useState(false);
  const [forget, setForget] = useState(false);
  const [reviewId, setReviewId] = useState<string>();
  const [resume, setResume] = useState(false);
  const opportunity = advisor.state === 'ready' ? advisor.primary : undefined;
  const relatedId = opportunity?.evidence.map(e => /^observation:([^:]+):/.exec(e.id)?.[1]).find(Boolean);
  const topic = selected ? observation.topics.find(t => t.id === selected)
    : observation.topics.find(t => t.id === relatedId) ?? observation.topics[0];
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); onUpdated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); onUpdated(); }
    finally { setBusy(false); }
  };
  const command = async (value: ObservationCommandRequest['command']) => {
    const response = await fetchJson<unknown>(apiUrl('/api/home/observation/command'), {
      method: 'POST', body: JSON.stringify({ expectedRevision: observation.revision, idempotencyKey: crypto.randomUUID(), command: value }),
    });
    return ObservationStateSchema.parse(response);
  };
  const label = observation.status === 'disabled' ? (zh ? '开启长期观察' : 'Start observing')
    : observation.status === 'paused' ? (zh ? '观察已暂停' : 'Observation paused')
    : observation.analyzedRevision < observation.revision ? (zh ? '已接收新记录，等待分析' : 'New records awaiting analysis')
    : (zh ? '持续观察中 · 等待新记录' : 'Observing · waiting for new records');

  return <section className="rounded-xl border border-edge bg-surface-panel p-4" aria-label={zh ? '交给我' : 'Let me handle it'} aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-fg">{zh ? '交给我' : 'Let me handle it'}</h3>
      <span className="text-xs text-fg-muted" role="status">{label}</span>
    </div>
    <p className="mt-2 text-xs text-fg-muted">{zh ? '在同一个观察会话里，积累你的工作轨迹、反馈和试做结果。' : 'Work, feedback and trial outcomes stay linked in one observation session.'}</p>
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
    {selected && !topic && text ? <p className="mt-2 text-sm text-fg-muted">{zh ? '此主题已不可用，未将你的输入转给其他主题。未保存的内容：' : 'This topic is unavailable. Your draft was not reassigned: '}{text}</p> : null}
    {advisor.state === 'quiet' && ['model_unavailable','generation_failed','budget_exhausted'].includes(advisor.reason) ? <p className="mt-2 text-xs text-fg-muted" role="status">{zh ? '记录已保留，当前分析暂不可用。请检查模型配置或稍后重试；不会丢失反馈。' : 'Records are preserved. Analysis is temporarily unavailable; check the model or retry later. Feedback is retained.'}</p> : null}
    {observation.status === 'disabled' ? <div className="mt-3 space-y-3">
      <p className="text-sm text-fg-muted">{zh ? '开启后回看最近 30 天已授权的私人会话，再增量处理新任务和反馈。不扫描屏幕，不自动创建定时任务。' : 'Review up to 30 days of authorized private conversations, then process new work and feedback incrementally. No screen recording or recurring jobs.'}</p>
      <Button disabled={busy} onClick={() => void run(async () => { await command({ kind: 'start', backfillDays: 30 }); })}>{zh ? '开启观察' : 'Start observation'}</Button>
    </div> : <>
      {topic ? <p className="mt-3 text-sm font-medium text-fg">{topic.title}</p> : <p className="mt-3 text-sm text-fg-muted">{zh ? '暂时没有足够的线索。有完整的新任务后再判断。' : 'Waiting for enough evidence from new work.'}</p>}
      {observation.status === 'active' && opportunity && topic && relatedId === topic.id ? <div className="mt-3 space-y-2">
        <p className="text-sm font-semibold text-fg">{opportunity.title}</p>
        <p className="text-sm text-fg-muted">{opportunity.rationale}</p>
        <details className="text-xs text-fg-muted"><summary>{zh ? '查看依据' : 'Evidence'}</summary>{opportunity.evidence.map(e => <p className="mt-2" key={e.id}>{e.observation}</p>)}</details>
        {opportunity.risk === 'analysis' ? <Button disabled={busy} onClick={() => void run(async () => {
          const result = HomeOpportunityActionResponseSchema.parse(await fetchJson(apiUrl('/api/home/observation/trial'), {
            method: 'POST', body: JSON.stringify({ topicId: topic.id, opportunityId: opportunity.id,
              expectedRevision: observation.revision, expectedOpportunityRevision: opportunity.revision, idempotencyKey: crypto.randomUUID() }),
          }));
          if (result.outcome === 'task') setReviewId(result.taskId);
          else throw new Error(zh ? '请先完成相关能力配置。' : 'Set up the required capabilities first.');
        })}>{zh ? '先做一份私人草稿' : 'Try a private draft'}</Button> : <p className="text-xs text-fg-muted">{zh ? '这项建议需要读取或修改外部服务，当前仅支持讨论与私人分析试做。' : 'This suggestion needs external access. Discuss its scope before proceeding.'}</p>}
      </div> : null}
      {topic && observation.status === 'active' ? <Button className="mt-3" variant="ghost" disabled={busy} aria-expanded={editing} onClick={() => { setSelected(topic.id); setEditing(!editing); }}>{zh ? '补充一句 / 调整要求' : 'Add feedback / refine requirements'}</Button> : null}
      {topic && observation.status === 'active' ? <Button variant="ghost" disabled={busy} onClick={() => void run(async () => {
        const result = await fetchJson<{ conversationId: string }>(apiUrl('/api/home/observation/discussion'), {
          method: 'POST', body: JSON.stringify({ topicId: topic.id, expectedRevision: observation.revision, idempotencyKey: crypto.randomUUID() }),
        });
        window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: result }));
      })}>{zh ? '展开聊聊' : 'Discuss in chat'}</Button> : null}
      {editing && topic ? <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void run(async () => {
        await command({ kind: 'feedback', topicId: topic.id, text, scope }); setText(''); setEditing(false); setJournal(true);
      }); }}>
        <label className="block text-xs text-fg-muted">{zh ? '希望我记住什么？' : 'What should I remember?'}
          <textarea required maxLength={1000} value={text} onChange={e => setText(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-edge bg-surface-inset p-2 text-sm text-fg" />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label={zh ? '反馈范围' : 'Feedback scope'}>
          {(['once','project','similar'] as const).filter(s => s !== 'project' || topic.projectId).map(s => <Button key={s} type="button" variant={s === scope ? 'secondary' : 'ghost'} aria-pressed={s === scope} onClick={() => setScope(s)}>{s === 'once' ? (zh ? '仅本次' : 'This trial only') : s === 'project' ? (zh ? '当前项目' : 'This project') : (zh ? '长期同类任务' : 'Similar future work')}</Button>)}
        </div>
        <p className="text-xs text-fg-muted">{zh ? '保留原话与范围。仅本次不会成为长期规则；反馈不代表执行授权。' : 'Keep the original words and scope. One-off feedback is not a standing rule or authorization.'}</p>
        <Button type="submit" disabled={busy || !text.trim()}>{zh ? '保存反馈' : 'Save feedback'}</Button>
      </form> : null}
      {topic?.trials.length ? <div className="mt-3 space-y-2">{topic.trials.map(t => <div className="flex flex-wrap items-center justify-between gap-2" key={t.taskId}><span className="text-xs text-fg-muted">{t.title} · {t.phase}{t.resolution ? ` / ${t.resolution}` : ''}</span><Button variant="ghost" onClick={() => setReviewId(reviewId === t.taskId ? undefined : t.taskId)}>{zh ? '查看试做与验收' : 'Review trial'}</Button></div>)}</div> : null}
      {reviewId ? <HomeTaskReview taskId={reviewId} language={language} onComplete={onUpdated} /> : null}
      {topic?.routine?<RoutinePanel routine={topic.routine} language={language} onUpdated={onUpdated}/>:topic?.trials[0]&&['review','closed'].includes(topic.trials[0].phase)?<RoutineAdoption topicId={topic.id} trial={topic.trials[0]} language={language} onUpdated={onUpdated}/>:null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-edge-subtle pt-2">
        <Button variant="ghost" aria-expanded={journal} onClick={() => setJournal(!journal)}>{zh ? '观察记录' : 'Observation journal'}</Button>
        <Button disabled={busy} variant="ghost" onClick={() => observation.status === 'active' ? void run(async () => { await command({ kind: 'pause' }); }) : setResume(!resume)}>{observation.status === 'active' ? (zh ? '暂停观察' : 'Pause observation') : (zh ? '恢复观察' : 'Resume observation')}</Button>
      </div>
      <p className="text-xs text-fg-muted">{zh ? '观察范围：已授权的 xopc 私人会话与关联试做回执。暂停观察不影响已有自动化。' : 'Scope: authorized private xopc conversations and linked trial receipts. Pausing does not stop existing automations.'}</p>
      {resume ? <div className="mt-2 flex flex-wrap gap-2">{(['catch_up','new_only'] as const).map(mode => <Button key={mode} disabled={busy} onClick={() => void run(async () => { await command({ kind: 'resume', mode }); setResume(false); })}>{mode === 'catch_up' ? (zh ? '补看暂停期间记录' : 'Catch up') : (zh ? '仅看之后的新记录' : 'New records only')}</Button>)}</div> : null}
      {journal ? <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-1">{observation.topics.map(t => <Button variant="ghost" key={t.id} aria-pressed={topic?.id === t.id} onClick={() => { if (!editing || !text) { setSelected(t.id); setForget(false); } }}>{t.title}</Button>)}</div>
        {topic?.entries.map(e => <div className="border-l border-edge pl-3 text-xs text-fg-muted" key={e.id}><time>{new Date(e.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}</time><p className="mt-1 whitespace-pre-wrap break-words">{e.text}</p></div>)}
        {topic?.feedback.filter(f => f.status === 'active').map(f => <div className="rounded-lg bg-surface-inset p-2 text-xs text-fg" key={f.id}><p>{f.text}</p><p className="text-fg-muted">{f.scope === 'once' ? (zh ? '仅本次' : 'One trial') : f.scope === 'project' ? (zh ? '当前项目' : 'Project') : (zh ? '长期同类任务' : 'Similar work')}</p><Button disabled={busy} variant="ghost" onClick={() => void run(async () => { await command({ kind: 'retract', topicId: topic.id, feedbackId: f.id }); })}>{zh ? '撤回反馈' : 'Retract'}</Button></div>)}
        {topic ? <Button variant="ghost" disabled={busy} onClick={() => setForget(true)}>{zh ? '忘记并排除此主题' : 'Forget and exclude topic'}</Button> : null}
        {forget && topic ? <div className="space-y-2 rounded-lg border border-edge p-3"><p className="text-sm text-fg">{zh ? '清除派生理解与反馈，并排除同一来源主题。原始记录、已有任务和自动化保留。' : 'Clear derived records and feedback and exclude this source topic. Original records, tasks and automations remain.'}</p><Button disabled={busy} onClick={() => void run(async () => { await command({ kind: 'forget', topicId: topic.id }); setSelected(undefined); setForget(false); setText(''); setEditing(false); setReviewId(undefined); })}>{zh ? '确认忘记' : 'Confirm forget'}</Button><Button variant="ghost" onClick={() => setForget(false)}>{zh ? '取消' : 'Cancel'}</Button></div> : null}
      </div> : null}
    </>}
  </section>;
}
