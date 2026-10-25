import { useState } from 'react';
import { CalendarClock, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';


import { openAutomationConfigurationChat } from './automation-create-navigation';

const ideas = [
  ['☀️', '晨间简报', '每天开始工作前，整理今天值得关注的任务与进展。', 'Morning briefing', 'Start each day with your tasks and project updates.', '每天早上帮我整理当天到期、逾期的任务和项目进展，给出今天的重点。', 'Each morning, summarize my due and overdue tasks and project progress, and suggest priorities.'],
  ['📝', '每周工作回顾', '回顾一周的成果和问题，为下周留出清晰的方向。', 'Weekly review', 'Review the week and find a clear direction for the next.', '每周五帮我回顾本周完成的任务和项目进展，整理未解决的问题，建议下周的重点。', 'Every Friday, review completed tasks and project progress, unresolved issues, and priorities for next week.'],
  ['🌱', '项目进展跟进', '定期看看项目进度，找出需要你关注的事情。', 'Project check-in', 'Keep an eye on project progress and what needs attention.', '定期帮我检查项目进度，整理延期、阻塞和需要我决策的事项。先和我确认关注哪个项目以及运行时间。', 'Regularly review a project for delays, blockers, and decisions I need to make. Ask which project and when to run.'],
  ['🔔', '重要事项提醒', '把容易忘记的事情交给提醒，安心专注眼前。', 'A timely reminder', 'Make room to focus by setting a reminder for later.', '我想安排一个重要事项提醒。请先问我需要提醒什么、什么时候提醒，以及是否重复。', 'Help me schedule a reminder. Ask what to remember, when, and whether it should repeat.'],
  ['📚', '笔记整理', '回看新收集的想法，整理出值得继续推进的线索。', 'Notes roundup', 'Revisit recent ideas and surface useful next steps.', '每周帮我回顾最近新增的笔记，按主题整理，找出值得继续推进的想法。请先确认时间和范围。', 'Each week, group my recent notes by topic and suggest ideas worth pursuing. Confirm the schedule and scope.'],
  ['🧭', '明日工作计划', '下班前梳理未完成的事，安排明天最重要的三件事。', 'Plan tomorrow', 'Wrap up loose ends and choose tomorrow’s top three priorities.', '每个工作日下班前，帮我梳理未完成的任务，建议明天最重要的三件事。请先确认具体时间。', 'Before the end of each workday, review unfinished tasks and suggest tomorrow’s top three priorities. Confirm the time.'],
  ['🗓️', '月度复盘', '拉远一点看进展，发现反复出现的问题和新的机会。', 'Monthly reflection', 'Step back to spot progress, recurring problems, and opportunities.', '每月月底帮我回顾项目和任务的进展，总结成果、反复出现的问题和下个月的重点。请确认运行时间。', 'At the end of each month, review project and task progress, achievements, recurring problems, and priorities. Confirm the schedule.'],
  ['🎯', '逾期任务检查', '定期发现被搁置的事项，让重要的事重新向前。', 'Overdue task check', 'Find neglected tasks and get important work moving again.', '定期帮我检查逾期任务，按紧迫程度整理，并建议下一步。请先确认运行频率和时间。', 'Regularly review overdue tasks, prioritize them by urgency, and suggest next steps. Confirm the frequency and time.'],
] as const;

export function pickAutomationIdeas(random = Math.random) {
  const shuffled = [...ideas];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 6);
}

export function AutomationDiscovery({ language, projectId, onOpenConversation }: { language: 'zh' | 'en'; projectId?: string; onOpenConversation?: (href: string) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async (prompt?: string) => {
    setBusy(true); setError('');
    try { const href = await openAutomationConfigurationChat({ projectId, prompt }); if (onOpenConversation) onOpenConversation(href); else navigate(href); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const zh = language === 'zh';
  const [suggestions, setSuggestions] = useState(pickAutomationIdeas);
  const content = <div className="mx-auto w-full max-w-3xl px-2 py-10 sm:px-6 md:py-20">
    <div className="text-center">
      <CalendarClock className="mx-auto size-10 text-fg-muted" strokeWidth={1.3} aria-hidden />
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-fg">{zh ? '安排任务' : 'Schedule a task'}</h2>
      <p className="mt-2 text-sm leading-6 text-fg-muted">{zh ? '说说你希望定期完成什么，我们一起安排好。' : 'Tell us what you’d like done regularly. We’ll work out the details together.'}</p>
    </div>
    <div className="mb-3 mt-10 flex items-center justify-between text-xs text-fg-muted">
      <span>{zh ? '也可以从这些想法开始' : 'Or start with an idea'}</span>
      <button type="button" onClick={() => setSuggestions(pickAutomationIdeas())} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"><RefreshCw className="size-3.5" aria-hidden />{zh ? '换一组' : 'More ideas'}</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {suggestions.map(idea => <button type="button" key={idea[1]} disabled={busy} onClick={() => void open(zh ? idea[5] : idea[6])} className="flex min-h-28 items-center gap-4 rounded-xl border border-dashed border-edge bg-surface-panel px-5 py-4 transition-colors hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="shrink-0 text-2xl" aria-hidden>{idea[0]}</span>
        <span className="min-w-0"><span className="block text-sm font-medium text-fg">{zh ? idea[1] : idea[3]}</span><span className="mt-1 block text-sm leading-5 text-fg-muted">{zh ? idea[2] : idea[4]}</span></span>
      </button>)}
    </div>
    <div className="mt-6 text-center"><button type="button" disabled={busy} onClick={() => void open()} className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">{zh ? '说说你想安排的其他任务' : 'Describe another task'}</button></div>
    {error ? <p role="alert" className="mt-3 text-center text-sm text-danger">{error}</p> : null}
  </div>;
  return <section aria-label={zh ? '安排任务' : 'Schedule a task'}>{content}</section>;
}
