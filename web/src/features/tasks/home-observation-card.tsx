import { useState } from 'react';
import { OBSERVATION_STARTER_COPY, HomeOpportunityActionResponseSchema, ObservationStateSchema, type HomeAdvisor, type ObservationState, type ObservationCommandRequest } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { FollowUpWorkbench } from './follow-up-workbench';
import { HomeTaskReview } from './home-task-review';
import { ObservationStarterList } from './observation-starter-list';
import { RoutineAdoption, RoutinePanel } from './routine-panel';

export function HomeObservationCard({ observation, advisor, language, onUpdated }: {
  observation: ObservationState; advisor: HomeAdvisor; language: 'zh' | 'en'; onUpdated(): void;
}) {
  const zh = language === 'zh';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showDrafts, setShowDrafts] = useState(false);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'once' | 'project' | 'similar'>('once');
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [historyTopicId, setHistoryTopicId] = useState<string>();
  const [journal, setJournal] = useState(false);
  const [forget, setForget] = useState(false);
  const [reviewId, setReviewId] = useState<string>();
  const [resume, setResume] = useState(false);
  const opportunity = advisor.state === 'ready' ? advisor.primary : undefined;
  const relatedId = opportunity?.evidence.map(e => /^observation:([^:]+):/.exec(e.id)?.[1]).find(Boolean);
  const savedTopics = observation.topics.filter(t => t.feedback.some(f => f.status === 'active') || t.trials.length || t.routine);
  const historyTopic = savedTopics.find(t => t.id === historyTopicId);
  const topic = selected ? observation.topics.find(t => t.id === selected)
    : observation.topics.find(t => t.routine && t.routine.status !== 'ended')
      ?? observation.topics.find(t => t.trials.length) ?? observation.topics.find(t => t.id === relatedId) ?? observation.topics[0];
  const suggestion = observation.status === 'active' && topic?.id === relatedId ? opportunity : undefined;
  const trial = topic?.trials[0];
  const hasWork = Boolean(topic?.routine || trial || suggestion);
  const unavailable = advisor.state === 'quiet' && ['model_unavailable', 'generation_failed', 'budget_exhausted'].includes(advisor.reason);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); onUpdated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); onUpdated(); }
    finally { setBusy(false); }
  };
  const command = async (value: ObservationCommandRequest['command']) => ObservationStateSchema.parse(await fetchJson<unknown>(apiUrl('/api/home/observation/command'), {
    method: 'POST', body: JSON.stringify({ expectedRevision: observation.revision, idempotencyKey: crypto.randomUUID(), command: value }),
  }));
  const edit = () => { if (topic) { setSelected(topic.id); setEditing(!editing); } };
  const discuss = () => topic && void run(async () => {
    const result = await fetchJson<{ conversationId: string }>(apiUrl('/api/home/observation/discussion'), {
      method: 'POST', body: JSON.stringify({ topicId: topic.id, expectedRevision: observation.revision, idempotencyKey: crypto.randomUUID() }),
    });
    window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: result }));
  });

  return <section className="rounded-xl border border-edge bg-surface-panel p-4" aria-label={zh ? '交给我' : 'Let me handle it'} aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-fg">{zh ? '交给我' : 'Let me handle it'}</h3>
      <Button variant="ghost" className="text-xs" aria-expanded={journal} onClick={() => setJournal(!journal)}>{zh ? '记录与设置' : 'History and settings'}</Button>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
    {notice ? <p role="status" className="mt-3 text-sm text-fg-muted">{notice}</p> : null}
    {selected && !topic && text ? <p className="mt-2 text-sm text-fg-muted">{zh ? '这件事已不在记录中。未保存的内容：' : 'This item is no longer available. Your unsaved note: '}{text}</p> : null}
    <FollowUpWorkbench observation={observation} language={language} onUpdated={onUpdated}/>
    {observation.status==='active'?<Button className="mt-3" variant="ghost" aria-expanded={showDrafts} onClick={()=>setShowDrafts(!showDrafts)}>{zh?'一次性整理与定期安排':'One-off drafts and recurring work'}</Button>:null}
    {(observation.status!=='active' || showDrafts) ? <>
    {observation.status === 'disabled' ? <div className="mt-3 space-y-3">
      <p className="text-base font-medium text-fg">{zh ? '把重复的事，慢慢交给我' : 'Let me take recurring work off your hands'}</p>
      <p className="max-w-prose text-sm leading-6 text-fg-muted">{zh ? '我会结合你在 xopc 中的工作记录，寻找可以代劳的事情。有合适的建议时，先做一次给你看。' : 'I can look through your work in xopc for tasks I could take on, then offer a first draft for you to review.'}</p>
      <Button variant="primary" disabled={busy} onClick={() => void run(async () => { await command({ kind: 'start', backfillDays: 30 }); })}>{zh ? '帮我发现重复工作' : 'Find recurring work'}</Button>
      <p className="text-xs leading-5 text-fg-muted">{zh ? '仅查看最近 30 天已授权的私人会话及后续工作记录。不扫描屏幕，定期执行前会请你确认。' : 'Uses up to 30 days of authorized private chats and new work. No screen recording. Recurring runs need your confirmation.'}</p>
    </div> : <>
      {!hasWork && observation.status === 'active' && observation.starters?.length ? <ObservationStarterList starters={observation.starters} revision={observation.revision} language={language} onStarted={setReviewId} onUpdated={onUpdated} /> : !hasWork ? <div className="mt-3 space-y-3">
        <p className="text-base font-medium text-fg">{zh ? '先做一件具体的事' : 'Start with a concrete task'}</p>
        <p className="max-w-prose text-sm leading-6 text-fg-muted">{observation.status === 'paused'
          ? (zh ? '已暂停寻找新建议。你也可以直接告诉我，哪件事最想少做一点。' : 'New suggestions are paused. You can still tell me what you would like to spend less time on.')
          : unavailable ? (zh ? '暂时无法生成新建议，已有记录和反馈都已保留。你也可以直接说说想交给我的事。' : 'New suggestions are temporarily unavailable. Your records and feedback are saved. You can still tell me what you would like help with.')
          : (zh ? '例如整理 PR 审查清单、汇总问题线索，或写一份工作进展草稿。先准备一次，满意后再设为定期执行。' : 'Prepare a PR review checklist, collect issue reports, or draft a work update. Try it once before making it recurring.')}</p>
        <div className="flex flex-wrap gap-2">{(['pr_review','issue_digest','work_summary'] as const).map(kind=>{
          const copy=OBSERVATION_STARTER_COPY[kind][language];
          const draft=zh?`请帮我准备「${copy.title}」。\n目标：${copy.output}\n\n要参考的资料或链接：\n\n先生成私人草稿；缺少资料时明确告诉我，不要开启定时执行。`:`Prepare ${copy.title}.\n${copy.output}\n\nSource material or links:\n\nCreate a private draft and flag missing information. Do not create recurring runs.`;
          return <Button key={kind} asChild><a href={`#/chat/new?${new URLSearchParams({draft})}`}>{copy.title}</a></Button>;
        })}</div>
        {observation.status === 'paused' ? <Button variant="ghost" onClick={() => setResume(!resume)}>{zh ? '恢复寻找建议' : 'Resume suggestions'}</Button> : null}
      </div> : topic?.routine ? <RoutinePanel key={topic.routine.id} routine={topic.routine} language={language} onUpdated={onUpdated} /> : trial ? <div className="mt-3 space-y-3">
        <p className="text-xs text-fg-muted">{['review', 'closed'].includes(trial.phase) ? (zh ? '先看看这次做得怎么样' : 'Review the first result') : (zh ? '先做一次，再决定是否定期交给我' : 'Try it once before making it recurring')}</p>
        <p className="text-base font-medium text-fg">{trial.title}</p>
        <p className="text-sm text-fg-muted">{zh ? '满意后再决定要不要定期交给我。' : 'Review the result before deciding whether to make it recurring.'}</p>
        <Button variant="primary" onClick={() => setReviewId(reviewId === trial.taskId ? undefined : trial.taskId)}>{zh ? '查看这次结果' : 'Review this result'}</Button>
        {['review', 'closed'].includes(trial.phase) ? <RoutineAdoption key={trial.taskId} topicId={topic.id} trial={trial} language={language} onUpdated={onUpdated} /> : null}
      </div> : suggestion && topic ? <div className="mt-3 space-y-3">
        <p className="text-xs text-fg-muted">{zh ? '这件事，可以先让我试试' : 'Here is something I could try'}</p>
        <p className="text-base font-medium text-fg">{suggestion.title}</p>
        <p className="text-sm leading-6 text-fg-muted">{suggestion.outcome}</p>
        {suggestion.risk === 'analysis' ? <Button variant="primary" disabled={busy} onClick={() => void run(async () => {
          const result = HomeOpportunityActionResponseSchema.parse(await fetchJson(apiUrl('/api/home/observation/trial'), {
            method: 'POST', body: JSON.stringify({ topicId: topic.id, opportunityId: suggestion.id, expectedRevision: observation.revision,
              expectedOpportunityRevision: suggestion.revision, idempotencyKey: crypto.randomUUID() }),
          }));
          if (result.outcome === 'task') setReviewId(result.taskId);
          else throw new Error(zh ? '请先完成相关能力配置。' : 'Set up the required capabilities first.');
        })}>{zh ? '先帮我做一次' : 'Try it once'}</Button> : <Button variant="primary" disabled={busy} onClick={discuss}>{zh ? '先确认怎么做' : 'Discuss the approach'}</Button>}
        <p className="text-xs text-fg-muted">{suggestion.risk === 'analysis' ? (zh ? '先生成私人草稿，由你查看后决定下一步。' : 'Start with a private draft for you to review.') : (zh ? '这件事需要外部服务，先一起确认范围。' : 'This needs an external service. Agree on the scope first.')}</p>
        <details className="text-xs text-fg-muted"><summary className="cursor-pointer">{zh ? '为什么推荐这件事' : 'Why this suggestion'}</summary><p className="mt-2 leading-5">{suggestion.rationale}</p>{suggestion.evidence.map(e => <p className="mt-2 leading-5" key={e.id}>{e.observation}</p>)}</details>
      </div> : null}
      {hasWork && topic && observation.status === 'active' ? <div className="mt-3 flex flex-wrap gap-1">
        <Button variant="ghost" disabled={busy} aria-expanded={editing} onClick={edit}>{zh ? '调整做法' : 'Refine the approach'}</Button>
        <Button variant="ghost" disabled={busy} onClick={discuss}>{zh ? '聊聊这件事' : 'Discuss this task'}</Button>
      </div> : null}
      {reviewId ? <HomeTaskReview taskId={reviewId} language={language} onComplete={onUpdated} /> : null}
      {resume ? <div className="mt-3 space-y-2"><p className="text-sm text-fg-muted">{zh ? '恢复后，要补看暂停期间的工作吗？' : 'Include work from while suggestions were paused?'}</p><div className="flex flex-wrap gap-2">{(['catch_up', 'new_only'] as const).map(mode => <Button key={mode} disabled={busy} onClick={() => void run(async () => { await command({ kind: 'resume', mode }); setResume(false); })}>{mode === 'catch_up' ? (zh ? '一起补看' : 'Include earlier work') : (zh ? '只看之后的工作' : 'New work only')}</Button>)}<Button variant="ghost" onClick={() => setResume(false)}>{zh ? '取消' : 'Cancel'}</Button></div></div> : null}
    </>}
    </> : null}
    {editing && topic ? <form className="mt-3 space-y-3 rounded-lg border border-edge p-3" onSubmit={event => { event.preventDefault(); void run(async () => {
      await command({ kind: 'feedback', topicId: topic.id, text, scope }); setText(''); setEditing(false); setNotice(zh ? '已记下。改变定期做法前，会先请你确认。' : 'Preference saved. I will ask before changing the recurring approach.');
    }); }}>
      <label className="block text-xs text-fg-muted">{zh ? `关于「${topic.title}」，希望我怎么做？` : `How should I handle “${topic.title}”?`}
        <textarea required maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder={zh ? '例如：先列出未解决的阻塞，每项附上来源。' : 'For example: list unresolved blockers first and include sources.'} className="mt-1 min-h-24 w-full rounded-lg border border-edge bg-surface-inset p-2 text-sm text-fg" />
      </label>
      <div className="flex flex-wrap gap-1" role="group" aria-label={zh ? '反馈范围' : 'Feedback scope'}>
        {(['once', 'project', 'similar'] as const).filter(s => s !== 'project' || topic.projectId).map(s => <Button key={s} type="button" variant={s === scope ? 'secondary' : 'ghost'} aria-pressed={s === scope} onClick={() => setScope(s)}>{s === 'once' ? (zh ? '仅这一次' : 'Just this time') : s === 'project' ? (zh ? '这个项目都适用' : 'This project') : (zh ? '以后这类事都适用' : 'Similar future work')}</Button>)}
      </div>
      <p className="text-xs text-fg-muted">{zh ? '记下你的要求；改变定期安排前，仍会请你确认。' : 'I will remember your preference and ask before changing a recurring arrangement.'}</p>
      <Button type="submit" variant="primary" disabled={busy || !text.trim()}>{zh ? '记住这个要求' : 'Save preference'}</Button><Button variant="ghost" onClick={() => { setEditing(false); setText(''); setScope('once'); }}>{zh ? '取消' : 'Cancel'}</Button>
    </form> : null}
    {journal ? <div className="mt-4 space-y-3 border-t border-edge-subtle pt-3">
      <p className="text-xs text-fg-muted" role="status">{observation.status === 'disabled' ? (zh ? '尚未开启' : 'Not enabled') : observation.status === 'paused' ? (zh ? '已暂停寻找新建议' : 'Suggestions paused') : observation.analyzedRevision < observation.revision ? (zh ? '正在整理最近的工作记录' : 'Reviewing recent work') : (zh ? '有新发现时会在这里告诉你' : 'New suggestions will appear here')}</p>
      <p className="text-xs leading-5 text-fg-muted">{zh ? '只查看已授权的 xopc 私人会话和相关任务结果。暂停寻找建议不会停止已经确认的定期安排。' : 'Uses authorized private xopc chats and related task results. Pausing suggestions does not stop confirmed recurring tasks.'}</p>
      {observation.status !== 'disabled' ? <Button disabled={busy} variant="ghost" onClick={() => observation.status === 'active' ? void run(async () => { await command({ kind: 'pause' }); }) : setResume(!resume)}>{observation.status === 'active' ? (zh ? '暂停寻找建议' : 'Pause suggestions') : (zh ? '恢复寻找建议' : 'Resume suggestions')}</Button> : null}
      {savedTopics.length ? <div className="space-y-3">
        <p className="text-xs font-medium text-fg">{zh ? '已保存的要求与试做' : 'Saved preferences and trials'}</p>
        <div className="max-h-48 space-y-2 overflow-y-auto">{savedTopics.map(t => <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-edge p-2"><span className="min-w-0 truncate text-sm text-fg">{t.routine?.title || t.trials[0]?.title || (zh ? '已保存的工作要求' : 'Saved work preferences')}</span><Button variant="ghost" disabled={Boolean(text) && t.id !== topic?.id} onClick={() => { setHistoryTopicId(t.id); setSelected(t.id); setForget(false); }}>{zh ? '管理' : 'Manage'}</Button></div>)}</div>
        {historyTopic ? <div className="space-y-2 rounded-lg bg-surface-inset p-3">
          {observation.status === 'active' ? <Button variant="ghost" disabled={busy} onClick={edit}>{zh ? '调整要求' : 'Edit preferences'}</Button> : null}
          {historyTopic.feedback.filter(f => f.status === 'active').map(f => <div className="text-xs text-fg" key={f.id}><p>{f.text}</p><Button disabled={busy} variant="ghost" onClick={() => void run(async () => { await command({ kind:'retract',topicId:historyTopic.id,feedbackId:f.id }); })}>{zh ? '撤回要求' : 'Retract preference'}</Button></div>)}
          {historyTopic.trials.map(t => <Button variant="ghost" key={t.taskId} onClick={() => setReviewId(t.taskId)}>{zh ? '查看结果：' : 'Review result: '}{t.title}</Button>)}
          <Button variant="ghost" disabled={busy} onClick={() => setForget(true)}>{zh ? '不再参考这件事' : 'Stop using this work history'}</Button>
          {forget ? <div className="space-y-2"><p className="text-sm text-fg">{zh ? '清除关于这件事的理解和要求。原始记录、已有任务和自动化保留。' : 'Forget this understanding and saved preferences. Original records, tasks and automations remain.'}</p><Button disabled={busy} onClick={() => void run(async () => { await command({kind:'forget',topicId:historyTopic.id});setSelected(undefined);setHistoryTopicId(undefined);setForget(false);setText('');setEditing(false);setReviewId(undefined); })}>{zh ? '确认不再参考' : 'Confirm exclusion'}</Button></div> : null}
        </div> : null}
      </div> : <p className="text-xs text-fg-muted">{zh ? '你确认的要求与试做结果会保存在这里。普通聊天记录仍在原对话中查看。' : 'Your saved preferences and trial results will appear here. View ordinary work history in its original chat.'}</p>}
    </div> : null}
  </section>;
}
