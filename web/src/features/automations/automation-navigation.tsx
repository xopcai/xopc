import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { useGatewayStore } from '@/stores/gateway-store';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
import type { MessageBundle } from '@/i18n/messages';
import type { Automation, AutomationRun } from './automation-api';
import { automationNextRunLabel, automationTriggerLabel, isCompletedOneTimeTask } from './automation-display';
import { automationHasExecutionIssue } from './automation-result-state';
import { AutomationItemMenu } from './automation-item-menu';
import { AutomationRunList, isAutomationRunActive } from './automation-run-list';

type AutomationsMessages = MessageBundle['automations'];
type CronMessages = MessageBundle['cron'];

export function AutomationNavigation({
  automations,
  runs,
  labels,
  cronLabels,
  language,
  selectedAutomationId, selectedRunId, selectedRun, projectId, executionSummaries, onSelectRun,
  onOpenDetails,
  busy, onEdit, onAction,
}: {
  automations: Automation[];
  runs: AutomationRun[];
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  selectedAutomationId: string | null;
  selectedRunId?: string;
  selectedRun?: AutomationRun | null;
  projectId?: string;
  executionSummaries?: Record<string, { unreadCount: number }>;
  onSelectRun: (run: AutomationRun) => void;
  onOpenDetails: (automationId: string) => void;
  busy: boolean; onEdit: (automation: Automation) => void;
  onAction: (key: string, action: () => Promise<unknown>, title?: string) => Promise<boolean>;
}) {
  const gateway = useGatewayStore(state => state.baseUrl);
  const identity = useGatewayStore(state => state.conversationId);
  const storageKey = `xopc.automation-navigation:${gateway}:${identity ?? 'local'}`;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}; } catch { return {}; }
  });
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); setExpanded(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}); } catch { setExpanded({}); }
  }, [storageKey]);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedAutomationId || lastSelected.current === selectedAutomationId) return;
    lastSelected.current = selectedAutomationId;
    setExpanded(previous => ({ ...previous, [selectedAutomationId]: true }));
  }, [selectedAutomationId]);
  const toggle = (id: string) => setExpanded(previous => {
    const next = { ...previous, [id]: !previous[id] };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Navigation works without storage. */ }
    return next;
  });
  if (automations.length === 0) {
    return <p className="p-4 text-sm text-fg-muted">{labels.empty.filtered}</p>;
  }
  return (
    <div className="min-h-0 overflow-y-auto divide-y divide-edge-subtle">
      {automations.map((automation) => {
        const recentRuns = runs
          .filter((run) => run.automationId === automation.id)
          .sort((a, b) => b.createdAtMs - a.createdAtMs);
        const activeRun = recentRuns.find(isAutomationRunActive);
        return (
          <div key={automation.id} className="group relative">
          <button type="button" aria-expanded={Boolean(expanded[automation.id])} aria-controls={`automation-runs-${automation.id}`}
            aria-label={language === 'zh' ? `${expanded[automation.id] ? '收起' : '展开'} ${automation.name} 的执行记录` : `${expanded[automation.id] ? 'Collapse' : 'Expand'} executions for ${automation.name}`}
            className="absolute left-1 top-2 z-10 rounded-md p-2 text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => toggle(automation.id)}>
            {expanded[automation.id] ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <button
            type="button"
            className={cn(
              'block w-full p-3 pl-9 pr-10 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
              selectedAutomationId === automation.id && !selectedRunId && 'bg-surface-hover',
            )}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 76px' }}
            aria-current={selectedAutomationId === automation.id && !selectedRunId ? 'true' : undefined}
            onClick={() => onOpenDetails(automation.id)}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn(
                'size-2 shrink-0 rounded-full',
                activeRun
                  ? 'bg-blue-500'
                  : automationHasExecutionIssue(automation, recentRuns)
                    ? 'bg-red-500'
                    : automation.enabled
                      ? 'bg-emerald-500'
                      : 'bg-fg-subtle',
              )} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{automation.name}</span>
              <span className="shrink-0 text-xs text-fg-muted">{isCompletedOneTimeTask(automation) ? (language === 'zh' ? '已完成' : 'Completed') : automation.enabled ? labels.enabled : labels.paused}</span>
              {(executionSummaries?.[automation.id]?.unreadCount ?? 0) > 0 ? (
                <span className="ml-auto size-2 shrink-0 rounded-full bg-blue-500">
                  <span className="sr-only">{labels.filters.unread}</span>
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate pl-4 text-xs leading-5 text-fg-muted">
              {automation.enabled ? <>{automationNextRunLabel(automation, labels, language)}<span className="mx-1.5">·</span></> : null}
              {automationTriggerLabel(automation.trigger, labels, cronLabels, language)}
            </p>
            {automationHasExecutionIssue(automation, recentRuns) ? <p className="mt-1 pl-4 text-xs text-red-700 dark:text-red-300">{labels.dashboard.needsAttention}</p> : null}
          </button>
          <div id={`automation-runs-${automation.id}`} hidden={!expanded[automation.id]}>
            <AutomationRunList automationId={automation.id} projectId={projectId} language={language} selectedRunId={selectedRunId} selectedRun={selectedRun} enabled={Boolean(expanded[automation.id])} onSelectRun={onSelectRun} />
          </div>
          <div className="absolute right-1 top-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><AutomationItemMenu automation={automation} language={language} busy={busy} onEdit={onEdit} onAction={onAction} /></div>
          </div>
        );
      })}
    </div>
  );
}

