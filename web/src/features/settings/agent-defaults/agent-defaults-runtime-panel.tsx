import { useMemo } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import type { AgentDefaults } from '@/features/settings/types/agent-gateway';
import { listWorkflowDefinitions } from '@/features/workflows/workflow-api';
import { cn } from '@/lib/cn';

const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

function positiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function AgentDefaultsRuntimePanel({
  draft,
  setDraft,
  zh,
}: {
  draft: AgentDefaults;
  setDraft: (draft: AgentDefaults) => void;
  zh: boolean;
}) {
  const workflowsQuery = useSWR('agent-defaults-workflows', listWorkflowDefinitions, { revalidateOnFocus: false });
  const workflowOptions = useMemo(
    () => (workflowsQuery.data ?? []).map((workflow) => ({ value: workflow.id, label: workflow.title || workflow.name })),
    [workflowsQuery.data],
  );
  const allWorkflows = draft.workflows.allowed === undefined;

  const setAllowedWorkflow = (id: string, enabled: boolean) => {
    const current = draft.workflows.allowed ?? [];
    const allowed = enabled ? [...new Set([...current, id])] : current.filter((item) => item !== id);
    setDraft({ ...draft, workflows: { ...draft.workflows, allowed } });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <h2 className="text-base font-semibold text-fg">{zh ? '执行限制' : 'Execution limits'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{zh ? '为所有 Agent 设置安全上限；留空时使用系统默认值。' : 'Set safe upper bounds for every agent. Empty fields use system defaults.'}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="block text-xs font-medium text-fg-muted">{zh ? '每次运行最多轮数' : 'Maximum turns per run'}<input type="number" min={1} value={draft.runtime.maxTurns ?? ''} placeholder={zh ? '系统默认' : 'System default'} onChange={(event) => setDraft({ ...draft, runtime: { ...draft.runtime, maxTurns: positiveInt(event.target.value) } })} className={`${inputClass} mt-2`} /></label>
          <label className="block text-xs font-medium text-fg-muted">{zh ? '单轮超时（毫秒）' : 'Turn timeout (ms)'}<input type="number" min={1} value={draft.runtime.timeoutMs ?? ''} placeholder={zh ? '系统默认' : 'System default'} onChange={(event) => setDraft({ ...draft, runtime: { ...draft.runtime, timeoutMs: positiveInt(event.target.value) } })} className={`${inputClass} mt-2`} /></label>
          <label className="block text-xs font-medium text-fg-muted">{zh ? '每轮最多工具失败次数' : 'Maximum tool failures per turn'}<input type="number" min={1} value={draft.runtime.maxToolFailuresPerTurn ?? ''} placeholder={zh ? '系统默认' : 'System default'} onChange={(event) => setDraft({ ...draft, runtime: { ...draft.runtime, maxToolFailuresPerTurn: positiveInt(event.target.value) } })} className={`${inputClass} mt-2`} /></label>
        </div>
      </section>

      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <h2 className="text-base font-semibold text-fg">{zh ? '提示词缓存' : 'Prompt cache'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{zh ? '复用稳定的上下文以降低响应延迟和模型费用。' : 'Reuse stable context to reduce latency and model cost.'}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="text-xs font-medium text-fg-muted"><span>{zh ? '缓存模式' : 'Cache mode'}</span><div className="mt-1.5 flex rounded-lg bg-surface-panel p-1">{(['auto', 'off'] as const).map((mode) => <Button key={mode} variant={draft.runtime.promptCache?.mode === mode ? 'secondary' : 'ghost'} className="flex-1 py-1.5 text-xs" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { mode, lifetime: draft.runtime.promptCache?.lifetime ?? 'short' } } })}>{mode === 'auto' ? (zh ? '自动' : 'Automatic') : (zh ? '关闭' : 'Off')}</Button>)}</div></div>
          {draft.runtime.promptCache?.mode === 'auto' ? <div className="text-xs font-medium text-fg-muted"><span>{zh ? '缓存周期' : 'Cache lifetime'}</span><div className="mt-1.5 flex rounded-lg bg-surface-panel p-1">{(['short', 'long'] as const).map((lifetime) => <Button key={lifetime} variant={draft.runtime.promptCache?.lifetime === lifetime ? 'secondary' : 'ghost'} className="flex-1 py-1.5 text-xs" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { mode: 'auto', lifetime } } })}>{lifetime === 'short' ? (zh ? '短期' : 'Short') : (zh ? '长期' : 'Long')}</Button>)}</div></div> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-edge bg-surface-base p-5">
        <h2 className="text-base font-semibold text-fg">{zh ? '工作流' : 'Workflows'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{zh ? '设置默认工作流，并决定 Agent 可以调用哪些工作流。' : 'Set a default workflow and control which workflows agents may invoke.'}</p>
        <div className="mt-5 max-w-xl">
          <label className="block text-xs font-medium text-fg-muted">{zh ? '默认工作流' : 'Default workflow'}</label>
          <PopoverSelect value={draft.workflows.default ?? ''} options={workflowOptions} placeholder={workflowsQuery.isLoading ? (zh ? '正在加载…' : 'Loading…') : (zh ? '不设置默认工作流' : 'No default workflow')} emptyLabel={zh ? '不设置默认工作流' : 'No default workflow'} disabled={workflowsQuery.isLoading} ariaLabel={zh ? '默认工作流' : 'Default workflow'} onChange={(value) => setDraft({ ...draft, workflows: { ...draft.workflows, default: value || undefined } })} triggerClassName="mt-2" />
        </div>
        {workflowsQuery.error ? <p className="mt-3 text-sm text-red-600">{workflowsQuery.error instanceof Error ? workflowsQuery.error.message : String(workflowsQuery.error)}</p> : null}

        <div className="mt-6 border-t border-edge pt-5">
          <h3 className="text-sm font-medium text-fg">{zh ? '允许调用的工作流' : 'Allowed workflows'}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setDraft({ ...draft, workflows: { ...draft.workflows, allowed: undefined } })} className={cn('rounded-xl border p-4 text-left', allWorkflows ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-edge bg-surface-panel hover:border-edge-strong')}><span className="block text-sm font-medium text-fg">{zh ? '允许全部工作流' : 'Allow every workflow'}</span><span className="mt-1 block text-xs text-fg-muted">{zh ? '新增工作流也会自动可用。' : 'New workflows become available automatically.'}</span></button>
            <button type="button" onClick={() => setDraft({ ...draft, workflows: { ...draft.workflows, allowed: [] } })} className={cn('rounded-xl border p-4 text-left', !allWorkflows ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-edge bg-surface-panel hover:border-edge-strong')}><span className="block text-sm font-medium text-fg">{zh ? '只允许选中的工作流' : 'Allow selected workflows only'}</span><span className="mt-1 block text-xs text-fg-muted">{zh ? '未选中的工作流不能被调用。' : 'Unselected workflows cannot be invoked.'}</span></button>
          </div>
          {!allWorkflows ? <div className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-surface-panel">{(workflowsQuery.data ?? []).map((workflow) => <label key={workflow.id} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-hover/60"><input type="checkbox" checked={draft.workflows.allowed?.includes(workflow.id) ?? false} onChange={(event) => setAllowedWorkflow(workflow.id, event.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" /><span><span className="block text-sm font-medium text-fg">{workflow.title || workflow.name}</span>{workflow.description ? <span className="mt-1 block text-xs text-fg-muted">{workflow.description}</span> : null}</span></label>)}{(workflowsQuery.data ?? []).length === 0 && !workflowsQuery.isLoading ? <p className="px-4 py-8 text-center text-sm text-fg-muted">{zh ? '还没有工作流。' : 'No workflows yet.'}</p> : null}</div> : null}
        </div>
      </section>
    </div>
  );
}
