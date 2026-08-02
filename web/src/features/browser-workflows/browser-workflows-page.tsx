import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Bot, CirclePause, CirclePlay, Clock3, Globe2, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useLocaleStore } from '@/stores/locale-store';
import {
  browserWorkflowApi,
  type BrowserWorkflow,
  type BrowserWorkflowRun,
  type BrowserWorkflowRunStatus,
} from './browser-workflow-api';
import {
  BrowserWorkflowInputFields,
  browserWorkflowInputsComplete,
  defaultBrowserWorkflowInputs,
} from './browser-workflow-inputs';

const copy = {
  en: {
    title: 'Browser automations', subtitle: 'Let your assistant repeat routine actions on the web.', emptyTitle: 'No browser automations yet', emptyBody: 'Tell your assistant what to do on the web. Once it works, save it and run it again whenever you need.', create: 'Create with assistant', edit: 'Edit with assistant', run: 'Run now', stop: 'Stop', enable: 'Enable', pause: 'Pause', enabled: 'Enabled', paused: 'Paused', inputs: 'Before running', noInputs: 'This automation is ready to run.', history: 'Recent activity', delete: 'Delete automation', confirmDelete: 'Delete this browser automation?', required: 'Please complete all required fields.', queued: 'Waiting to start', running: 'Running', succeeded: 'Completed', failed: 'Needs attention', cancelled: 'Stopped', result: 'Result', read_only: 'Reads information', account_write: 'Changes account data', sensitive: 'Sensitive action', createPrompt: 'Help me create a reusable browser automation. Ask what I want the browser to do, perform it once with me, then save the successful steps. Keep all technical details hidden.', editPrompt: 'Help me update the browser automation "{name}" (id: {id}). Ask what should change, test the new browser steps, then save it.',
  },
  zh: {
    title: '浏览器自动化', subtitle: '让助手自动重复完成网页上的固定操作。', emptyTitle: '还没有浏览器自动化', emptyBody: '告诉助手你希望在网页上自动完成什么。成功执行一次后，即可保存并重复运行。', create: '让助手帮我创建', edit: '让助手帮我修改', run: '立即运行', stop: '停止', enable: '启用', pause: '暂停', enabled: '已启用', paused: '已暂停', inputs: '运行前需要填写', noInputs: '这个自动化可以直接运行。', history: '最近运行', delete: '删除自动化', confirmDelete: '确定删除这个浏览器自动化吗？', required: '请填写所有必填内容。', queued: '等待开始', running: '正在运行', succeeded: '已完成', failed: '需要处理', cancelled: '已停止', result: '运行结果', read_only: '仅读取信息', account_write: '会修改账户数据', sensitive: '包含敏感操作', createPrompt: '请帮我创建一个可重复运行的浏览器自动化。先询问我希望浏览器完成什么，陪我实际执行成功一次，然后保存成功步骤。不要让我处理技术细节。', editPrompt: '请帮我修改浏览器自动化“{name}”（id：{id}）。先询问我要修改什么，实际测试新的浏览器步骤，然后保存。',
  },
};

function isTerminal(status: BrowserWorkflowRunStatus) {
  return status !== 'queued' && status !== 'running';
}

function formatResult(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => `• ${formatResult(item)}`).join('\n');
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${formatResult(item)}`)
    .join('\n');
  return String(value);
}

export function BrowserWorkflowsPage() {
  const language = useLocaleStore((state) => state.language);
  const text = copy[language];
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [workflows, setWorkflows] = useState<BrowserWorkflow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [runs, setRuns] = useState<BrowserWorkflowRun[]>([]);
  const [activeRun, setActiveRun] = useState<BrowserWorkflowRun>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = useMemo(() => workflows?.find((workflow) => workflow.id === selectedId), [selectedId, workflows]);

  const loadWorkflows = useCallback(async () => {
    const data = await browserWorkflowApi.list();
    setWorkflows(data.workflows);
    setSelectedId((current) => current && data.workflows.some((workflow) => workflow.id === current) ? current : data.workflows[0]?.id);
  }, []);

  useEffect(() => { void loadWorkflows().catch((error) => setMessage(String(error))); }, [loadWorkflows]);
  useEffect(() => {
    if (!selected) return;
    setInputs(defaultBrowserWorkflowInputs(selected));
    setActiveRun(undefined);
    setMessage('');
    void browserWorkflowApi.listRuns(selected.id).then((data) => setRuns(data.runs)).catch((error) => setMessage(String(error)));
  }, [selected]);
  useEffect(() => {
    if (!activeRun || isTerminal(activeRun.status)) return;
    const timer = window.setInterval(() => {
      void browserWorkflowApi.getRun(activeRun.id).then(({ run }) => {
        setActiveRun(run);
        if (isTerminal(run.status) && selected) void browserWorkflowApi.listRuns(selected.id).then((data) => setRuns(data.runs));
      }).catch((error) => setMessage(String(error)));
    }, 700);
    return () => window.clearInterval(timer);
  }, [activeRun, selected]);

  const openAssistant = useCallback((prompt: string) => {
    navigate(`/chat/new?draft=${encodeURIComponent(prompt)}`);
  }, [navigate]);
  const headerEnd = useMemo(() => (
    <Button onClick={() => openAssistant(text.createPrompt)}><Bot className="size-4" />{text.create}</Button>
  ), [openAssistant, text.create, text.createPrompt]);
  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{text.title}</h1>
          <p className="truncate text-xs text-fg-muted">{text.subtitle}</p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, text.subtitle, text.title]);
  const setEnabled = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await browserWorkflowApi.setEnabled(selected.id, !selected.enabled);
      await loadWorkflows();
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!selected) return;
    if (!browserWorkflowInputsComplete(selected, inputs)) { setMessage(text.required); return; }
    setBusy(true);
    try {
      const { run: nextRun } = await browserWorkflowApi.run(selected.id, inputs);
      setActiveRun(nextRun);
      setMessage('');
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selected || !window.confirm(text.confirmDelete)) return;
    setBusy(true);
    try {
      await browserWorkflowApi.remove(selected.id);
      setSelectedId(undefined);
      setRuns([]);
      await loadWorkflows();
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };

  if (workflows === null) {
    return <div className="flex min-h-0 flex-1 flex-col bg-surface-panel p-4 sm:p-6"><div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><Skeleton className="h-[420px] rounded-xl" /><Skeleton className="h-[420px] rounded-xl" /></div></div>;
  }

  if (workflows.length === 0) {
    return <div className="flex min-h-0 flex-1 flex-col bg-surface-panel p-4 sm:p-6"><div className="m-auto max-w-md rounded-2xl border border-edge bg-surface-base p-8 text-center"><Bot className="mx-auto size-10 text-accent" /><h2 className="mt-4 text-lg font-semibold text-fg">{text.emptyTitle}</h2><p className="mt-2 text-sm leading-6 text-fg-muted">{text.emptyBody}</p><Button className="mt-5" onClick={() => openAssistant(text.createPrompt)}><Bot className="size-4" />{text.create}</Button></div></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-panel p-4 sm:p-6">
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto rounded-xl border border-edge bg-surface-base p-2">
          {workflows.map((workflow) => <button key={workflow.id} onClick={() => setSelectedId(workflow.id)} className={`mb-1 w-full rounded-lg p-3 text-left ${selectedId === workflow.id ? 'bg-accent-soft text-accent-fg' : 'hover:bg-surface-hover'}`}><span className="block truncate text-sm font-medium">{workflow.name}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">{workflow.enabled ? <CirclePlay className="size-3.5 text-emerald-600" /> : <CirclePause className="size-3.5" />}{workflow.enabled ? text.enabled : text.paused}</span></button>)}
        </aside>
        {selected && <main className="min-h-0 overflow-y-auto rounded-xl border border-edge bg-surface-base p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 className="text-lg font-semibold text-fg">{selected.name}</h2>{selected.description && <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{selected.description}</p>}<div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-surface-subtle px-2.5 py-1 text-fg-muted">{text[selected.risk]}</span>{selected.domains.map((domain) => <span key={domain} className="flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-1 text-fg-muted"><Globe2 className="size-3" />{domain}</span>)}</div></div><div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => void setEnabled()}>{selected.enabled ? <CirclePause className="size-4" /> : <CirclePlay className="size-4" />}{selected.enabled ? text.pause : text.enable}</Button><Button variant="secondary" onClick={() => openAssistant(text.editPrompt.replace('{name}', selected.name).replace('{id}', selected.id))}><Pencil className="size-4" />{text.edit}</Button></div></div>
          <section className="mt-7 max-w-xl"><h3 className="text-sm font-semibold text-fg">{text.inputs}</h3>{Object.keys(selected.inputs).length === 0 ? <p className="mt-2 text-sm text-fg-muted">{text.noInputs}</p> : <div className="mt-3"><BrowserWorkflowInputFields workflow={selected} values={inputs} language={language} onChange={setInputs} /></div>}<div className="mt-5 flex gap-2"><Button variant="primary" disabled={!selected.enabled || busy || Boolean(activeRun && !isTerminal(activeRun.status))} onClick={() => void run()}><Play className="size-4" />{text.run}</Button>{activeRun && !isTerminal(activeRun.status) && <Button variant="secondary" onClick={() => void browserWorkflowApi.cancel(activeRun.id)}><Square className="size-4" />{text.stop}</Button>}</div>{message && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{message}</p>}</section>
          {activeRun && <section className="mt-7 rounded-xl border border-edge bg-surface-subtle p-4"><div className="flex items-center gap-2 text-sm font-medium text-fg"><Clock3 className="size-4" />{text[activeRun.status]}</div>{activeRun.error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{activeRun.error}</p>}{activeRun.status === 'succeeded' && activeRun.result !== undefined && <div className="mt-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{text.result}</h3><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm text-fg">{formatResult(activeRun.result)}</pre></div>}</section>}
          <section className="mt-8"><h3 className="text-sm font-semibold text-fg">{text.history}</h3><div className="mt-2 divide-y divide-edge">{runs.slice(0, 10).map((item) => <button key={item.id} className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:text-accent" onClick={() => setActiveRun(item)}><span>{text[item.status]}</span><span className="text-xs text-fg-muted">{new Date(item.createdAtMs).toLocaleString()}{item.durationMs ? ` · ${Math.max(1, Math.round(item.durationMs / 1000))}s` : ''}</span></button>)}</div></section>
          <div className="mt-8 border-t border-edge pt-4"><Button variant="ghost" className="text-red-700 dark:text-red-300" disabled={busy} onClick={() => void remove()}><Trash2 className="size-4" />{text.delete}</Button></div>
        </main>}
      </div>
    </div>
  );
}
