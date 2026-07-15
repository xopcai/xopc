import { Link2, Plus, Target, Unlink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  attachWebchatGoal,
  createWebchatGoal,
  detachWebchatGoal,
  fetchWebchatGoal,
  listWebchatGoals,
  type WebchatPersistentGoalWire,
} from '@/features/chat/goals/goals-api';
import {
  listWorkflowDefinitions,
  startGoalWorkflowRun,
  type WorkflowDefinition,
} from '@/features/workflows/workflow-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { showToast } from '@/lib/toast';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { useLocaleStore } from '@/stores/locale-store';

const inputClass =
  'min-w-0 rounded-md border border-edge bg-surface-muted px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

function goalLabel(goal: WebchatPersistentGoalWire): string {
  const prefix = goal.status === 'blocked' || goal.status === 'needs_input' ? `${goal.status}: ` : '';
  return `${prefix}${goal.title}`;
}

export function ChatGoalComposerMenu({
  sessionKey,
  disabled,
  onDone,
}: {
  sessionKey: string | null;
  disabled: boolean;
  onDone?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).chat.goal;
  const [current, setCurrent] = useState<WebchatPersistentGoalWire | null>(null);
  const [goals, setGoals] = useState<WebchatPersistentGoalWire[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [title, setTitle] = useState('');
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionKey) return;
    setError(null);
    try {
      const [currentRes, listRes] = await Promise.all([
        fetchWebchatGoal(sessionKey),
        listWebchatGoals({ limit: 100 }),
      ]);
      setCurrent(currentRes.goal);
      setGoals(listRes.goals);
      setSelectedGoalId((prev) => prev || listRes.goals.find((goal) => goal.id !== currentRes.goal?.id)?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : t.composerLoadGoalsFailed);
    }
  }, [sessionKey, t.composerLoadGoalsFailed]);

  useEffect(() => {
    let cancelled = false;
    void listWorkflowDefinitions()
      .then((definitions) => {
        if (cancelled) return;
        setWorkflows(definitions);
        setSelectedWorkflowId((prev) => prev || definitions[0]?.id || '');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t.composerLoadWorkflowsFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [t.composerLoadWorkflowsFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchableGoals = useMemo(
    () => goals.filter((goal) => goal.id !== current?.id),
    [goals, current?.id],
  );

  const notifySessionGoalChanged = useCallback(() => {
    if (!sessionKey) return;
    window.dispatchEvent(new CustomEvent('session-updated', { detail: { key: sessionKey } }));
  }, [sessionKey]);

  const startGoal = async () => {
    if (!sessionKey) return;
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setBusy('start');
    setError(null);
    try {
      const res = await createWebchatGoal(sessionKey, nextTitle);
      setCurrent(res.goal);
      setTitle('');
      notifySessionGoalChanged();
      showToast({ type: 'success', title: t.composerGoalStarted, message: nextTitle });
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.composerStartGoalFailed);
    } finally {
      setBusy(null);
    }
  };

  const attachGoal = async () => {
    if (!sessionKey || !selectedGoalId) return;
    setBusy('attach');
    setError(null);
    try {
      const res = await attachWebchatGoal(sessionKey, selectedGoalId);
      setCurrent(res.goal);
      notifySessionGoalChanged();
      showToast({ type: 'success', title: t.composerGoalAttached, message: res.goal?.title });
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.composerAttachGoalFailed);
    } finally {
      setBusy(null);
    }
  };

  const detachGoal = async () => {
    if (!current) return;
    setBusy('detach');
    setError(null);
    try {
      await detachWebchatGoal(current.id);
      setCurrent(null);
      notifySessionGoalChanged();
      showToast({ type: 'info', title: t.composerGoalDetached });
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.composerDetachGoalFailed);
    } finally {
      setBusy(null);
    }
  };

  const runWorkflow = async () => {
    if (!current || !selectedWorkflowId) return;
    setBusy('workflow');
    setError(null);
    try {
      const result = await startGoalWorkflowRun({
        goalId: current.id,
        definitionId: selectedWorkflowId,
        goal: current.nextAction || current.title,
      });
      notifySessionGoalChanged();
      showToast({ type: 'success', title: t.composerWorkflowStarted, message: current.title });
      window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: { sessionKey: result.sessionKey } }));
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.composerStartWorkflowFailed);
    } finally {
      setBusy(null);
    }
  };

  const inactive = disabled || !sessionKey || busy != null;

  return (
    <div className="grid w-72 gap-2 px-1 py-1 text-xs">
      <div className="flex items-center gap-2 px-1.5 text-fg">
        <Target className="size-4 text-accent-fg" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">{t.composerHeading}</div>
          <div className="truncate text-fg-muted">{current ? goalLabel(current) : t.composerNoGoalAttached}</div>
        </div>
      </div>

      <div className="grid gap-1.5 rounded-md border border-edge/70 bg-surface-muted/30 p-2">
        <div className="font-medium text-fg-muted">{t.composerStartGoal}</div>
        <div className="flex gap-1.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={cn(inputClass, 'flex-1')}
            placeholder={t.composerGoalTitlePlaceholder}
            disabled={inactive}
          />
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-white disabled:opacity-50"
            disabled={inactive || !title.trim()}
            title={t.composerStartGoal}
            aria-label={t.composerStartGoal}
            onClick={() => void startGoal()}
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid gap-1.5 rounded-md border border-edge/70 bg-surface-muted/30 p-2">
        <div className="font-medium text-fg-muted">{current ? t.composerSwitchGoal : t.composerAttachGoal}</div>
        <div className="flex gap-1.5">
          <Select
            value={selectedGoalId}
            onChange={(e) => setSelectedGoalId(e.target.value)}
            className={cn(inputClass, 'flex-1')}
            disabled={inactive || switchableGoals.length === 0}
          >
            {switchableGoals.length === 0 ? <SelectOption value="">{t.composerNoOpenGoals}</SelectOption> : null}
            {switchableGoals.map((goal) => (
              <SelectOption key={goal.id} value={goal.id}>
                {goalLabel(goal)}
              </SelectOption>
            ))}
          </Select>
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-edge text-fg hover:bg-surface-hover disabled:opacity-50"
            disabled={inactive || !selectedGoalId}
            title={current ? t.composerSwitchGoal : t.composerAttachGoal}
            aria-label={current ? t.composerSwitchGoal : t.composerAttachGoal}
            onClick={() => void attachGoal()}
          >
            <Link2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <button
        type="button"
        className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-left text-fg hover:bg-surface-hover disabled:opacity-50"
        disabled={inactive || !current}
        onClick={() => void detachGoal()}
      >
        <Unlink className="size-4 text-fg-subtle" aria-hidden />
        {t.composerDetachCurrent}
      </button>
      <div className="grid gap-1.5 rounded-md border border-edge/70 bg-surface-muted/30 p-2">
        <div className="font-medium text-fg-muted">{t.composerRunWorkflow}</div>
        <div className="flex gap-1.5">
          <Select
            value={selectedWorkflowId}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            className={cn(inputClass, 'flex-1')}
            disabled={inactive || !current || workflows.length === 0}
          >
            {workflows.length === 0 ? <SelectOption value="">{t.composerNoWorkflows}</SelectOption> : null}
            {workflows.map((workflow) => (
              <SelectOption key={workflow.id} value={workflow.id}>
                {workflow.title || workflow.name}
              </SelectOption>
            ))}
          </Select>
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-edge text-fg hover:bg-surface-hover disabled:opacity-50"
            disabled={inactive || !current || !selectedWorkflowId}
            title={t.composerRunWorkflow}
            aria-label={t.composerRunWorkflow}
            onClick={() => void runWorkflow()}
          >
            <Target className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive">{error}</div> : null}
    </div>
  );
}
