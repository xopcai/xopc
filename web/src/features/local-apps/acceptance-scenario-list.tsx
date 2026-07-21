import { CircleCheck, CircleX, Clock3, Loader2, MessageSquareCode, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LocalAppCriteriaScenarioResult } from '@/features/local-apps/runtime-health';

export type LocalAppAcceptanceScenarioSummary = {
  id: string;
  name: string;
  stepCount: number;
};

type Props = {
  scenarios: LocalAppAcceptanceScenarioSummary[];
  results: Record<string, LocalAppCriteriaScenarioResult>;
  runningTarget: 'all' | string | null;
  zh: boolean;
  onRunAll: () => void;
  onRunScenario: (scenarioId: string) => void;
  onAskCoder: (scenario: LocalAppAcceptanceScenarioSummary, result: LocalAppCriteriaScenarioResult) => void;
};

export function AcceptanceScenarioList({
  scenarios,
  results,
  runningTarget,
  zh,
  onRunAll,
  onRunScenario,
  onAskCoder,
}: Props) {
  if (!scenarios.length) return null;

  return (
    <div className="mt-3 border-t border-edge-subtle pt-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-fg">{zh ? '产品场景' : 'Product scenarios'}</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            {zh ? `${scenarios.length} 个关键用户路径` : `${scenarios.length} critical user journey${scenarios.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Button
          variant="ghost"
          className="h-7 rounded-lg px-2 text-[11px]"
          onClick={onRunAll}
          disabled={runningTarget !== null}
        >
          {runningTarget === 'all' ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          {zh ? '全部重跑' : 'Run all'}
        </Button>
      </div>
      <ul className="mt-2 divide-y divide-edge-subtle" aria-label={zh ? '产品场景验收结果' : 'Product scenario acceptance results'}>
        {scenarios.map((scenario) => {
          const result = results[scenario.id];
          const running = runningTarget === 'all' || runningTarget === scenario.id;
          const status = running ? 'running' : result?.status ?? 'pending';
          return (
            <li key={scenario.id} className="py-2.5 first:pt-1">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {status === 'running' ? <Loader2 className="size-3.5 animate-spin text-accent" />
                    : status === 'passed' ? <CircleCheck className="size-3.5 text-success" />
                      : status === 'failed' ? <CircleX className="size-3.5 text-danger" />
                        : <Clock3 className="size-3.5 text-fg-subtle" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-fg">{scenario.name}</p>
                      <p className="mt-0.5 text-[10px] text-fg-subtle">
                        {zh ? `${scenario.stepCount} 个步骤` : `${scenario.stepCount} step${scenario.stepCount === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="size-7 shrink-0 rounded-lg p-0"
                      onClick={() => onRunScenario(scenario.id)}
                      disabled={runningTarget !== null}
                      aria-label={zh ? `重跑${scenario.name}` : `Rerun ${scenario.name}`}
                      title={zh ? '单独重跑' : 'Rerun scenario'}
                    >
                      <RefreshCw className="size-3" />
                    </Button>
                  </div>
                  {status === 'running' ? (
                    <p className="mt-1 text-[11px] leading-4 text-fg-muted">{zh ? '正在隔离预览中执行…' : 'Running in an isolated preview…'}</p>
                  ) : result?.status === 'failed' ? (
                    <div className="mt-1.5">
                      <p className="text-[11px] leading-4 text-danger">{result.message}</p>
                      <Button
                        variant="ghost"
                        className="mt-1 h-7 rounded-lg px-2 text-[11px] text-danger hover:text-danger"
                        onClick={() => onAskCoder(scenario, result)}
                      >
                        <MessageSquareCode className="size-3" />
                        {zh ? '让 Coder 修复' : 'Ask Coder to fix'}
                      </Button>
                    </div>
                  ) : result?.status === 'passed' ? (
                    <p className="mt-1 text-[11px] leading-4 text-fg-muted">{zh ? '场景已通过' : 'Scenario passed'}</p>
                  ) : (
                    <p className="mt-1 text-[11px] leading-4 text-fg-muted">{zh ? '等待运行' : 'Waiting to run'}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
