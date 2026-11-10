import { useState } from 'react';
import { FollowUpSchema, type FollowUp, type FollowUpCommand, type ObservationState } from '@xopcai/gateway-contract';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { HomeTaskReview } from './home-task-review';
export function FollowUpWorkbench({ observation, language, onUpdated }: {
    observation: ObservationState;
    language: 'zh' | 'en';
    onUpdated(): void;
}) {
    const zh = language === 'zh', items = observation.followUps ?? [];
    const [creating, setCreating] = useState(false), [goal, setGoal] = useState(''), [criteria, setCriteria] = useState(''), [firstStep, setFirstStep] = useState('');
    const [topicIds, setTopicIds] = useState<string[]>([]), [auto, setAuto] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const open = (candidate?: NonNullable<ObservationState['followUpCandidates']>[number]) => {
        setGoal(candidate?.goal ?? '');
        setFirstStep(candidate?.firstStep ?? (zh?'先整理已有线索、已知事实和资料缺口，再提出下一步建议。':'Organize existing evidence, known facts and missing material, then propose the next step.'));
        setCriteria('');
        setTopicIds(candidate ? [candidate.topicId] : observation.topics.slice(0, 3).map(t => t.id));
        setCreating(true);
        setError('');
    };
    return <div className="mt-3 space-y-4">
    {items.filter(f => !['done', 'ended'].includes(f.status)).map(item => <FollowUpCard key={item.id} followUp={item} language={language} onUpdated={onUpdated}/>)}
    {observation.status === 'active' ? <>
      {!items.some(f => !['done', 'ended'].includes(f.status)) ? <div className="space-y-2"><p className="text-base font-semibold text-fg">{zh ? '把一件事推进到完成' : 'Keep one goal moving until it is done'}</p><p className="text-sm leading-6 text-fg-muted">{zh ? '记住目标和进展，一步步整理证据、查清问题。有新资料继续推进，遇到阻塞会告诉你缺什么。' : 'Keep the goal and its progress together. Work through the evidence, continue when input arrives, and make blockers clear.'}</p></div> : null}
      {!creating ? (observation.followUpCandidates ?? []).map(c => <div key={c.topicId} className="space-y-2 rounded-lg border border-edge p-3"><p className="text-xs text-fg-muted">{zh ? '这条请求可能需要继续跟进，请先确认目标' : 'This request may need follow-through. Confirm the goal first.'}</p><p className="line-clamp-2 text-sm text-fg">{c.goal}</p><Button onClick={() => open(c)}>{zh ? '设为持续目标' : 'Set up a continuing goal'}</Button></div>) : null}
      {!creating ? <Button variant={items.some(f=>!['done','ended'].includes(f.status))?'ghost':'primary'} onClick={() => open()}>{items.some(f=>!['done','ended'].includes(f.status))?(zh?'再交给我一件事':'Add another goal'):(zh ? '交给我持续推进一件事' : 'Keep a goal moving')}</Button> : <form className="space-y-3 rounded-lg border border-edge bg-surface-inset p-3" onSubmit={event => {
                    event.preventDefault();
                    if (busy)
                        return;
                    setBusy(true);
                    setError('');
                    void fetchJson(apiUrl('/api/home/follow-ups'), { method: 'POST', body: JSON.stringify({ goal, criteria: criteria.split('\n').map(s => s.trim()).filter(Boolean), firstStep, topicIds, autoContinue: auto, stepBudget: 3, locale: language, expectedObservationRevision: observation.revision, idempotencyKey: crypto.randomUUID() }) })
                        .then(value => { FollowUpSchema.parse(value); setCreating(false); onUpdated(); }).catch(cause => { setError(cause instanceof Error ? cause.message : String(cause)); onUpdated(); }).finally(() => setBusy(false));
                }}>
        <label className="block text-sm text-fg">{zh ? '希望最终达成什么？' : 'What outcome should we reach?'}<textarea required maxLength={1000} value={goal} onChange={e => setGoal(e.target.value)} placeholder={zh ? '例如：查清 connector 重复请求的原因，并整理可验证的解决方案。' : 'For example: understand duplicate connector requests and prepare a verifiable resolution.'} className="mt-1 min-h-20 w-full rounded-lg border border-edge bg-surface-panel p-2"/></label>
        <label className="block text-sm text-fg">{zh ? '达到什么标准才算完成？每行一条，最多 10 项' : 'What counts as done? One criterion per line'}<textarea required maxLength={10000} value={criteria} onChange={e => setCriteria(e.target.value)} placeholder={zh ? '明确复现条件\n原因有日志或代码证据支持\n给出修复后需要通过的验证项' : 'Reproduction conditions are clear\nEvidence supports the cause\nVerification checks are defined'} className="mt-1 min-h-24 w-full rounded-lg border border-edge bg-surface-panel p-2"/></label>
        <label className="block text-sm text-fg">{zh ? '现在先推进哪一步？' : 'What is the first step?'}<input required maxLength={1000} value={firstStep} onChange={e => setFirstStep(e.target.value)} placeholder={zh ? '整理现有线索、已知事实和缺少的日志。' : 'Organize existing reports, known facts and missing logs.'} className="mt-1 w-full rounded-lg border border-edge bg-surface-panel p-2"/></label>
        <details><summary className="cursor-pointer text-xs text-fg-muted">{zh ? `参考资料范围：已选 ${topicIds.length} 段对话` : `Source scope: ${topicIds.length} selected conversations`}</summary><div className="mt-2 max-h-40 space-y-2 overflow-y-auto">{observation.topics.map(t => <label key={t.id} className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={topicIds.includes(t.id)} disabled={!topicIds.includes(t.id) && topicIds.length >= 8} onChange={e => setTopicIds(e.target.checked ? [...topicIds, t.id] : topicIds.filter(id => id !== t.id))}/><span className="truncate">{t.title}</span></label>)}</div></details>
        {!observation.topics.length ? <p className="text-sm text-fg-muted">{zh ? '先在对话里提供这件事的背景资料，开启观察后再选为参考来源。' : 'First provide the background in a chat, then select it as a source.'}</p> : null}
        <label className="flex items-start gap-2 text-xs leading-5 text-fg-muted"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="mt-1"/>{zh ? '资料齐备时自动继续本轮分析，最多 3 步；缺资料或检查未通过就停下。只整理资料和分析，不修改外部服务。' : 'Continue private analysis automatically, up to 3 steps this round. Stop for missing input or failed checks. No changes to external services.'}</label>
        <p className="text-xs text-fg-muted">{zh ? '一份阶段结果不等于整个目标完成。最终由你对照完成标准验收，随时可以暂停或结束。' : 'A step result does not complete the goal. You review the final criteria, and can pause or end at any time.'}</p>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !topicIds.length}>{zh ? '确认目标，开始第一步' : 'Confirm goal and start'}</Button><Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>{zh ? '取消' : 'Cancel'}</Button>
      </form>}
    </> : null}
    {items.some(f => ['done', 'ended'].includes(f.status)) ? <details><summary className="text-xs text-fg-muted">{zh ? '已结束的目标' : 'Past goals'}</summary>{items.filter(f => ['done', 'ended'].includes(f.status)).map(item => <FollowUpCard key={item.id} followUp={item} language={language} onUpdated={onUpdated}/>)}</details> : null}
  </div>;
}
export function FollowUpCard({ followUp: prop, language, onUpdated }: {
    followUp: FollowUp;
    language: 'zh' | 'en';
    onUpdated(): void;
}) {
    const zh = language === 'zh';
    const [local, setLocal] = useState<FollowUp>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [note, setNote] = useState(''), [next, setNext] = useState(''), [editingNext, setEditingNext] = useState(false), [reviewTask, setReviewTask] = useState<string>(), [accepting, setAccepting] = useState(false), [confirmEnd, setConfirmEnd] = useState(false);
    const [checked, setChecked] = useState<number[]>([]), [acceptanceNote, setAcceptanceNote] = useState('');
    const f = local && local.revision > prop.revision ? local : prop, last = f.steps.at(-1), ended = ['done', 'ended'].includes(f.status);
    const stateLabel = { working: last?.status === 'queued' ? (zh ? '下一步已安排' : 'Next step queued') : last && ['succeeded', 'failed', 'cancelled'].includes(last.status) ? (zh ? '正在整理本步结果' : 'Processing the step result') : (zh ? '正在推进' : 'In progress'), waiting: zh ? '等资料 / 待处理' : 'Waiting for input', review: zh ? '等你确认下一步' : 'Review next step', paused: zh ? '已暂停' : 'Paused', done: zh ? '已由你验收完成' : 'Accepted by you', ended: zh ? '已结束' : 'Ended' }[f.status];
    const act = (command: FollowUpCommand['command']) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        void fetchJson(apiUrl(`/api/home/follow-ups/${encodeURIComponent(f.id)}/command`), { method: 'POST', body: JSON.stringify({ expectedRevision: f.revision, idempotencyKey: crypto.randomUUID(), command }) })
            .then(value => { setLocal(FollowUpSchema.parse(value)); if (command.kind === 'add_input')
            setNote(''); setEditingNext(false); setAccepting(false); setConfirmEnd(false); onUpdated(); }).catch(cause => { const message = cause instanceof Error ? cause.message : String(cause); setError(/changed/i.test(message) ? (zh ? '这条目标有新进展，已刷新。请确认后再操作。' : 'Progress changed. Review the refreshed goal and try again.') : message); onUpdated(); }).finally(() => setBusy(false));
    };
    return <section className="space-y-3 rounded-lg border border-edge p-3" aria-label={zh ? '持续推进的目标' : 'Continuing goal'}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-accent-fg">{zh ? '持续推进' : 'Continuing goal'}</p><span className="text-xs text-fg-muted" role="status">{stateLabel}</span></div>
    <h4 className="break-words text-base font-semibold text-fg">{f.goal}</h4>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {f.stopPending ? <p className="text-sm text-fg-muted">{zh ? '已停止安排新步骤，正在确认上一步是否终止。' : 'No new steps will start until the previous execution is confirmed stopped.'}</p> : null}
    {f.summary ? <div><p className="text-xs text-fg-muted">{zh ? '最近进展' : 'Latest progress'}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{f.summary}</p></div> : null}
    {f.waitingFor ? <div className="rounded-lg bg-surface-inset p-3"><p className="text-xs text-fg-muted">{zh ? '当前需要' : 'What is needed'}</p><p className="mt-1 text-sm text-fg">{f.waitingFor === 'Source scope or goal contract needs review' ? (zh ? '参考资料或目标要求已变更，请先检查。' : 'Source scope or goal requirements need review.') : f.waitingFor === 'Step history changed; review before resuming' ? (zh ? '一步历史结果已删除，目标已暂停。请确认下一步后再继续。' : 'A step was deleted. Review the next action before resuming.') : f.waitingFor === 'New material awaits review' ? (zh ? '有新增资料还没核对，请先推进下一步。' : 'New material needs review before goal acceptance.') : f.waitingFor}</p></div> : null}
    {f.nextStep ? <div><p className="text-xs text-fg-muted">{f.status === 'working' ? (zh ? '当前这一步' : 'Current step') : (zh ? '建议下一步' : 'Proposed next step')}</p><p className="mt-1 break-words text-sm text-fg">{f.nextStep}</p></div> : null}
    {last ? <Button variant="secondary" onClick={() => setReviewTask(reviewTask === last.taskId ? undefined : last.taskId)}>{zh ? `查看第 ${last.number} 步的进度与结果` : `Review step ${last.number}`}</Button> : null}
    {!ended ? <>
      <p className="text-xs text-fg-muted">{f.autoContinue ? (zh ? `本轮还可自动推进 ${f.remainingSteps} 步。每步结果都会保留，遇到资料缺口会停下。` : `Up to ${f.remainingSteps} more automatic steps this round. Missing input stops progress.`) : (zh ? '每个下一步都由你确认后再执行。' : 'You confirm each next step before it runs.')}</p>
      {f.status === 'review' && !f.stopPending ? <Button variant="primary" disabled={busy} onClick={() => { setNext(f.nextStep); setEditingNext(!editingNext); }}>{f.nextStep ? (zh ? '确认或调整下一步' : 'Confirm or adjust next step') : (zh ? '安排下一步' : 'Set the next step')}</Button> : null}
      {editingNext ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); act({ kind: 'continue', nextStep: next, stepBudget: f.autoContinue ? 3 : 1 }); }}><label className="block text-xs text-fg-muted">{zh ? '下一步要完成什么？' : 'What should the next step deliver?'}<textarea required maxLength={1000} value={next} onChange={e => setNext(e.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-edge bg-surface-inset p-2 text-sm text-fg"/></label><p className="text-xs text-fg-muted">{f.autoContinue ? (zh ? '确认后，本轮最多再推进 3 步。' : 'Confirm up to 3 more private steps this round.') : (zh ? '确认后仅执行这一步。' : 'Confirm this step only.')}</p><Button type="submit" variant="primary" disabled={busy}>{zh ? '确认继续推进' : 'Continue with this step'}</Button></form> : null}
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); act({ kind: 'add_input', text: note }); }}><label className="block text-xs text-fg-muted">{zh ? '补充资料或最新情况' : 'Add evidence or an update'}<textarea required maxLength={8000} value={note} onChange={e => setNote(e.target.value)} placeholder={zh ? '粘贴复现条件、日志片段，或说明有什么新进展。' : 'Add reproduction steps, logs or new progress.'} className="mt-1 min-h-16 w-full rounded-lg border border-edge bg-surface-inset p-2 text-sm text-fg"/></label><Button variant={f.status === 'waiting' ? 'primary' : 'secondary'} disabled={busy || !note.trim()} type="submit">{f.status === 'waiting' && f.autoContinue && f.remainingSteps > 0 && last?.verified ? (zh ? '补充资料，继续推进' : 'Add evidence and continue') : (zh ? '补充到这条目标' : 'Add to this goal')}</Button></form>
      <div className="flex flex-wrap gap-1">{f.status === 'waiting' && !f.stopPending ? <Button variant="ghost" onClick={() => { setNext(f.nextStep); setEditingNext(!editingNext); }}>{zh ? '调整下一步' : 'Adjust next step'}</Button> : null}<Button variant="ghost" disabled={busy} onClick={() => act({ kind: f.status === 'paused' ? 'resume' : 'pause' })}>{f.status === 'paused' ? (zh ? '恢复推进' : 'Resume') : (zh ? '暂停推进' : 'Pause')}</Button>{last?.verified && f.status !== 'working' && !f.stopPending ? <Button variant="ghost" onClick={() => setAccepting(!accepting)}>{zh ? '验收整个目标' : 'Review goal completion'}</Button> : null}<Button variant="ghost" onClick={() => setConfirmEnd(!confirmEnd)}>{zh ? '结束跟进' : 'End follow-up'}</Button></div>
      {confirmEnd ? <div className="space-y-2"><p className="text-sm text-fg-muted">{zh ? '停止后续推进并请求取消当前步骤，保留已有结果。' : 'Stop further work and cancel the current step. Keep previous results.'}</p><Button disabled={busy} onClick={() => act({ kind: 'end' })}>{zh ? '确认结束跟进' : 'Confirm end'}</Button></div> : null}
      {accepting ? <form className="space-y-3 rounded-lg bg-surface-inset p-3" onSubmit={e => { e.preventDefault(); act({ kind: 'complete', confirmedCriteria: checked, note: acceptanceNote }); }}><p className="text-sm font-medium text-fg">{zh ? '请对照结果逐项确认，阶段产出不代表目标已完成。' : 'Confirm each criterion against the results. A completed step is not a completed goal.'}</p>{f.criteria.map((c, i) => <label key={i} className="flex items-start gap-2 text-sm text-fg-muted"><input type="checkbox" checked={checked.includes(i)} onChange={e => setChecked(e.target.checked ? [...checked, i] : checked.filter(n => n !== i))}/>{c}</label>)}<label className="block text-xs text-fg-muted">{zh ? '验收依据' : 'Acceptance evidence'}<textarea required maxLength={1000} value={acceptanceNote} onChange={e => setAcceptanceNote(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-surface-panel p-2 text-sm"/></label><Button type="submit" variant="primary" disabled={busy || checked.length !== f.criteria.length || !acceptanceNote.trim()}>{zh ? '确认目标已完成' : 'Accept completed goal'}</Button></form> : null}
    </> : null}
    <details><summary className="cursor-pointer text-xs text-fg-muted">{zh ? '完成标准与推进记录' : 'Acceptance criteria and step history'}</summary><ul className="mt-2 list-disc pl-4 text-sm text-fg-muted">{f.criteria.map(c => <li key={c}>{c}</li>)}</ul>{f.steps.map(step => <div key={step.number} className="mt-2 flex items-center justify-between gap-2 border-l border-edge pl-3 text-xs text-fg-muted"><span>{step.number}. {step.action} · {step.verified ? (zh ? '本步检查通过' : 'Step checked') : (zh ? '结果待核查' : 'Needs review')}</span><Button variant="ghost" onClick={() => setReviewTask(step.taskId)}>{zh ? '查看' : 'Review'}</Button></div>)}</details>
    {reviewTask ? <HomeTaskReview taskId={reviewTask} language={language} onComplete={onUpdated}/> : null}
    <a className="inline-block text-xs text-accent-fg" href={`#/tasks/${encodeURIComponent(f.rootTaskId)}`}>{zh ? '查看完整目标与子任务' : 'View the goal and its child tasks'}</a>
  </section>;
}
