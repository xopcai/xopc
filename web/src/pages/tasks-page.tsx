import * as Dialog from '@radix-ui/react-dialog';
import type { TaskPriority } from '@xopcai/gateway-contract';
import { AlertCircle, CheckCircle2, Clock, FolderKanban, Plus, Search, Target, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { fetchProjects } from '@/features/projects/api';
import { createTask, listTasks, type TaskListItem } from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import {
  formatTaskPresentationStatus,
  formatTaskStage,
  taskPresentationStage,
  taskStatusBadgeTone,
  taskStatusDotTone,
  type TaskPresentationStage,
} from '@/features/tasks/task-status';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { showActivity } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

type TaskStageFilter = 'open' | 'needs_user' | 'in_progress' | 'review' | 'ready' | 'closed' | 'all';

const PRIORITY_TONES: Record<TaskPriority, string> = {
  low: 'text-fg-subtle',
  normal: 'text-fg-muted',
  high: 'text-warning',
  critical: 'text-danger font-medium',
};

function matchesStageFilter(item: TaskListItem, filter: TaskStageFilter): boolean {
  const stage: TaskPresentationStage = taskPresentationStage(item.presentation.status);
  if (filter === 'all') return true;
  if (filter === 'open') return stage !== 'completed' && stage !== 'ended';
  if (filter === 'closed') return stage === 'completed' || stage === 'ended';
  if (filter === 'ready') return stage === 'ready' || stage === 'backlog';
  return stage === filter;
}

export function TasksPage() {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const copy = taskCopy(language);
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;

  const [filter, setFilter] = useState<TaskStageFilter>('open');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [createOpen, setCreateOpen] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('normal');
  const [newPhase, setNewPhase] = useState<'backlog' | 'ready'>('ready');
  const [newAgentId, setNewAgentId] = useState('');
  const [newCriteriaText, setNewCriteriaText] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error, mutate } = useSWR(
    ['global-tasks', search.trim(), projectId, priority],
    () => listTasks({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(projectId ? { projectId } : {}),
      ...(priority ? { priority } : {}),
      limit: 200,
      order: 'recent',
    }),
    { revalidateOnFocus: true },
  );

  const { data: projectsData } = useSWR('global-tasks-projects', () => fetchProjects({ limit: 100 }));
  const { data: agentsData } = useSWR(createOpen ? 'global-tasks-agents' : null, () => fetchChatAgents());

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void mutate(), 120);
    };
    window.addEventListener('task-changed-v2', refresh);
    window.addEventListener('task-changed-v1', refresh);
    window.addEventListener('task-deleted-v1', refresh);
    window.addEventListener('gateway-realtime-connected', refresh);
    window.addEventListener('realtime-gap', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('task-changed-v2', refresh);
      window.removeEventListener('task-changed-v1', refresh);
      window.removeEventListener('task-deleted-v1', refresh);
      window.removeEventListener('gateway-realtime-connected', refresh);
      window.removeEventListener('realtime-gap', refresh);
    };
  }, [mutate]);

  const projectNames = useMemo(
    () => new Map((projectsData?.items ?? []).map((p) => [p.id, p.name])),
    [projectsData?.items],
  );

  const allItems = data?.items ?? [];

  const counts = useMemo(() => {
    const map: Record<TaskStageFilter, number> = {
      open: 0,
      needs_user: 0,
      in_progress: 0,
      review: 0,
      ready: 0,
      closed: 0,
      all: allItems.length,
    };
    for (const item of allItems) {
      const stage = taskPresentationStage(item.presentation.status);
      if (stage === 'completed' || stage === 'ended') {
        map.closed += 1;
      } else {
        map.open += 1;
        if (stage === 'needs_user') map.needs_user += 1;
        else if (stage === 'in_progress') map.in_progress += 1;
        else if (stage === 'review') map.review += 1;
        else map.ready += 1;
      }
    }
    return map;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const list = allItems.filter((item) => matchesStageFilter(item, filter));
    const rank = (item: TaskListItem) => {
      const stage = taskPresentationStage(item.presentation.status);
      if (stage === 'needs_user') return 0;
      if (stage === 'review') return 1;
      if (stage === 'in_progress') return 2;
      if (stage === 'ready') return 3;
      if (stage === 'backlog') return 4;
      return 5;
    };
    return [...list].sort((a, b) => rank(a) - rank(b) || b.task.updatedAt - a.task.updatedAt);
  }, [allItems, filter]);

  const tabs: Array<{ id: TaskStageFilter; label: string }> = [
    { id: 'open', label: zh ? '进行中与待办' : 'Open' },
    { id: 'needs_user', label: formatTaskStage('needs_user', language) },
    { id: 'in_progress', label: formatTaskStage('in_progress', language) },
    { id: 'review', label: formatTaskStage('review', language) },
    { id: 'ready', label: zh ? '待开始' : 'Ready & Backlog' },
    { id: 'closed', label: zh ? '已关闭' : 'Closed' },
    { id: 'all', label: zh ? '全部' : 'All' },
  ];

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const criteria = newCriteriaText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      await createTask({
        idempotencyKey: crypto.randomUUID(),
        title,
        ...(newBody.trim() ? { body: newBody.trim() } : {}),
        ...(newProjectId ? { projectId: newProjectId } : {}),
        ...(newAgentId ? { delegateAgentId: newAgentId } : {}),
        priority: newPriority,
        contract: {
          objective: newBody.trim() || title,
          expectedOutputs: [],
          acceptanceCriteria: criteria,
          constraints: [],
          approvalRequired: [],
          assumptions: [],
          risks: [],
          acceptancePolicy: criteria.length > 0 ? 'verified_then_review' : 'manual',
          outputDestinations: [],
        },
        dependencies: [],
        context: [],
        authorityGrants: [],
        activation: { mode: 'capture', phase: newPhase },
      });
      setNewTitle('');
      setNewBody('');
      setNewCriteriaText('');
      setNewProjectId('');
      setNewAgentId('');
      setNewPriority('normal');
      setNewPhase('ready');
      setCreateOpen(false);
      await mutate();
      showActivity({ title: zh ? '任务已创建' : 'Task created', tone: 'success' });
    } catch (cause) {
      showActivity({
        title: cause instanceof Error ? cause.message : (zh ? '创建任务失败' : 'Failed to create task'),
        tone: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">{zh ? '全部任务' : 'Tasks'}</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            {zh ? '统一查看跨项目、独立待办与后台委派任务。' : 'View project tasks, standalone todos, and background delegations in one place.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="size-4" aria-hidden />
          {zh ? '新建任务' : 'New task'}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-edge-subtle pb-3" role="tablist" aria-label={zh ? '任务状态筛选' : 'Task status filter'}>
        {tabs.map((tab) => {
          const active = filter === tab.id;
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(tab.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-surface-active text-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <span>{tab.label}</span>
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[11px]',
                active ? 'bg-surface-panel text-fg' : 'bg-surface-inset text-fg-subtle',
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & secondary filters */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh ? '搜索任务标题或目标…' : 'Search tasks by title or objective…'}
            className="h-9 w-full rounded-lg border border-edge bg-surface-panel pl-9 pr-3 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <Select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          aria-label={zh ? '按项目筛选' : 'Filter by project'}
          triggerClassName="h-9 min-w-[9.5rem] rounded-lg border border-edge bg-surface-panel px-2.5 text-xs text-fg"
        >
          <SelectOption value="">{zh ? '全部项目' : 'All projects'}</SelectOption>
          {(projectsData?.items ?? []).map((project) => (
            <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>
          ))}
        </Select>
        <Select
          value={priority}
          onChange={(event) => setPriority(event.target.value as TaskPriority | '')}
          aria-label={zh ? '按优先级筛选' : 'Filter by priority'}
          triggerClassName="h-9 min-w-[8rem] rounded-lg border border-edge bg-surface-panel px-2.5 text-xs text-fg"
        >
          <SelectOption value="">{zh ? '全部优先级' : 'All priorities'}</SelectOption>
          <SelectOption value="critical">{copy.priorityLabels.critical}</SelectOption>
          <SelectOption value="high">{copy.priorityLabels.high}</SelectOption>
          <SelectOption value="normal">{copy.priorityLabels.normal}</SelectOption>
          <SelectOption value="low">{copy.priorityLabels.low}</SelectOption>
        </Select>
      </div>

      {/* List */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-8">
        {isLoading ? (
          <div className="space-y-2.5" aria-busy="true">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center justify-between rounded-xl border border-edge bg-surface-panel p-4 text-sm text-fg-muted">
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="size-4 text-danger" aria-hidden />
              {zh ? '加载任务列表失败' : 'Failed to load tasks'}
            </span>
            <button
              type="button"
              onClick={() => void mutate()}
              className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover"
            >
              {zh ? '重试' : 'Retry'}
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-14 text-center">
            <Target className="size-8 text-fg-subtle" aria-hidden />
            <p className="mt-3 text-sm font-medium text-fg">
              {search.trim()
                ? (zh ? '没有匹配的任务' : 'No matching tasks')
                : (zh ? '当前筛选下暂无任务' : 'No tasks in this view')}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {zh ? '点击右上角“新建任务”，或在对话中直接交办给助手。' : 'Create a task above or delegate one directly in chat.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredItems.map((item) => {
              const status = item.presentation.status;
              const statusLabel = formatTaskPresentationStatus(status, language);
              const projectName = item.task.projectId ? projectNames.get(item.task.projectId) : undefined;
              const isCompleted = status === 'completed';
              return (
                <li key={item.task.id}>
                  <Link
                    to={taskDetailModalHref(returnTo, item.task.id)}
                    className="group flex items-start gap-3 rounded-xl border border-edge bg-surface-panel px-4 py-3 transition-colors hover:border-edge-strong hover:bg-surface-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', taskStatusDotTone(status))} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('truncate text-sm font-medium text-fg', isCompleted && 'text-fg-muted line-through')}>
                          {item.task.title}
                        </span>
                        <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium', taskStatusBadgeTone(status))}>
                          {isCompleted ? <CheckCircle2 className="mr-1 size-3" aria-hidden /> : null}
                          {statusLabel}
                        </span>
                      </div>
                      {item.presentation.reason || item.attention[0]?.summary ? (
                        <p className="mt-1 line-clamp-1 text-xs text-fg-muted">
                          {item.presentation.reason ?? item.attention[0]?.summary}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                        {projectName ? (
                          <span className="inline-flex items-center gap-1">
                            <FolderKanban className="size-3" aria-hidden />
                            {projectName}
                          </span>
                        ) : null}
                        {item.task.priority !== 'normal' ? (
                          <span className={PRIORITY_TONES[item.task.priority]}>
                            {copy.priorityLabels[item.task.priority]}
                          </span>
                        ) : null}
                        {item.task.dueAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" aria-hidden />
                            {new Date(item.task.dueAt).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}
                          </span>
                        ) : null}
                        <span>{formatMediumDateTime(item.task.updatedAt, language)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Create Task Dialog */}
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(36rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover">
            <div className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-5 py-3.5">
              <Dialog.Title className="text-sm font-semibold text-fg">
                {zh ? '新建任务' : 'New task'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="rounded-lg p-1 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? '关闭' : 'Close'}>
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={(event) => void handleCreate(event)} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="new-task-title">
                    {zh ? '标题' : 'Title'}
                  </label>
                  <input
                    id="new-task-title"
                    required
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder={zh ? '要完成什么目标？' : 'What needs to get done?'}
                    className="h-9 w-full rounded-lg border border-edge bg-surface-base px-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="new-task-body">
                    {zh ? '说明与背景（可选）' : 'Details (optional)'}
                  </label>
                  <textarea
                    id="new-task-body"
                    rows={3}
                    value={newBody}
                    onChange={(event) => setNewBody(event.target.value)}
                    placeholder={zh ? '补充上下文、交付要求或约束条件' : 'Background, scope, or delivery notes'}
                    className="w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="mb-1 block text-xs font-medium text-fg-muted">{zh ? '初始阶段' : 'Initial stage'}</span>
                    <Select
                      value={newPhase}
                      onChange={(event) => setNewPhase(event.target.value as 'backlog' | 'ready')}
                      triggerClassName="h-9 w-full rounded-lg border border-edge bg-surface-base px-2.5 text-sm text-fg"
                    >
                      <SelectOption value="ready">{zh ? '就绪（待开始）' : 'Ready'}</SelectOption>
                      <SelectOption value="backlog">{zh ? '待规划' : 'Backlog'}</SelectOption>
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-fg-muted">{copy.priority}</span>
                    <Select
                      value={newPriority}
                      onChange={(event) => setNewPriority(event.target.value as TaskPriority)}
                      triggerClassName="h-9 w-full rounded-lg border border-edge bg-surface-base px-2.5 text-sm text-fg"
                    >
                      <SelectOption value="low">{copy.priorityLabels.low}</SelectOption>
                      <SelectOption value="normal">{copy.priorityLabels.normal}</SelectOption>
                      <SelectOption value="high">{copy.priorityLabels.high}</SelectOption>
                      <SelectOption value="critical">{copy.priorityLabels.critical}</SelectOption>
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-fg-muted">{zh ? '所属项目' : 'Project'}</span>
                    <Select
                      value={newProjectId}
                      onChange={(event) => setNewProjectId(event.target.value)}
                      triggerClassName="h-9 w-full rounded-lg border border-edge bg-surface-base px-2.5 text-sm text-fg"
                    >
                      <SelectOption value="">{zh ? '无（独立任务）' : 'None (standalone)'}</SelectOption>
                      {(projectsData?.items ?? []).map((project) => (
                        <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-fg-muted">{copy.executorLabel}</span>
                    <Select
                      value={newAgentId}
                      onChange={(event) => setNewAgentId(event.target.value)}
                      triggerClassName="h-9 w-full rounded-lg border border-edge bg-surface-base px-2.5 text-sm text-fg"
                    >
                      <SelectOption value="">{copy.unassigned}</SelectOption>
                      {(agentsData?.items ?? []).map((agent) => (
                        <SelectOption key={agent.id} value={agent.id}>{agent.name || agent.id}</SelectOption>
                      ))}
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="new-task-criteria">
                    {zh ? '验收标准（每行一条，可选）' : 'Acceptance criteria (one per line, optional)'}
                  </label>
                  <textarea
                    id="new-task-criteria"
                    rows={3}
                    value={newCriteriaText}
                    onChange={(event) => setNewCriteriaText(event.target.value)}
                    placeholder={zh ? '例如：\n输出结构化对比表格\n附带原始来源链接' : 'e.g.\nStructured comparison table\nIncludes source links'}
                    className="w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge-subtle px-5 py-3">
                <Dialog.Close asChild>
                  <button type="button" className="h-9 rounded-lg border border-edge px-3.5 text-sm text-fg-muted hover:bg-surface-hover">
                    {zh ? '取消' : 'Cancel'}
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || creating}
                  className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {creating ? (zh ? '创建中…' : 'Creating…') : (zh ? '创建任务' : 'Create task')}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
