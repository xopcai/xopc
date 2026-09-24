import * as Popover from '@radix-ui/react-popover';
import type { HomeAdvisor } from '@xopcai/gateway-contract';
import { History, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface HomeAdvisorStatusCopy {
  label: string;
  ready: string;
  clarification: string;
  refreshing: string;
  refreshingDetail: string;
  idle: string;
  idleDetail: string;
  generationFailed: string;
  budgetExhausted: string;
  modelUnavailable: string;
  generationFailedDetail: string;
  budgetExhaustedDetail: string;
  modelUnavailableDetail: string;
  history: string;
  retry: string;
  findAnother: string;
}

interface AdvisorStatusPresentation {
  label: string;
  detail: string;
  tone: 'accent' | 'danger' | 'neutral' | 'warning';
  refreshing: boolean;
}

function interpolateCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

function presentAdvisorStatus(advisor: HomeAdvisor, copy: HomeAdvisorStatusCopy): AdvisorStatusPresentation | null {
  if (advisor.state === 'disabled') return null;
  if (advisor.state === 'ready') {
    const count = 1 + advisor.alternatives.length;
    return {
      label: interpolateCount(copy.ready, count),
      detail: advisor.primary.title,
      tone: 'accent',
      refreshing: Boolean(advisor.stale),
    };
  }
  if (advisor.state === 'clarification') {
    return {
      label: copy.clarification,
      detail: advisor.question.question,
      tone: 'accent',
      refreshing: false,
    };
  }
  if (advisor.state === 'refreshing') {
    return {
      label: copy.refreshing,
      detail: advisor.previous?.title ?? copy.refreshingDetail,
      tone: 'accent',
      refreshing: true,
    };
  }

  if (advisor.reason === 'generation_failed') {
    return {
      label: copy.generationFailed,
      detail: copy.generationFailedDetail,
      tone: 'danger',
      refreshing: false,
    };
  }
  if (advisor.reason === 'budget_exhausted') {
    return {
      label: copy.budgetExhausted,
      detail: copy.budgetExhaustedDetail,
      tone: 'warning',
      refreshing: false,
    };
  }
  if (advisor.reason === 'model_unavailable') {
    return {
      label: copy.modelUnavailable,
      detail: copy.modelUnavailableDetail,
      tone: 'warning',
      refreshing: false,
    };
  }
  return {
    label: copy.idle,
    detail: copy.idleDetail,
    tone: 'neutral',
    refreshing: false,
  };
}

const toneClass: Record<AdvisorStatusPresentation['tone'], string> = {
  accent: 'bg-accent',
  danger: 'bg-danger',
  neutral: 'bg-fg-subtle',
  warning: 'bg-warning',
};

export function HomeAdvisorStatusControl({
  advisor,
  busy,
  copy,
  onOpenHistory,
  onRefresh,
}: {
  advisor: HomeAdvisor;
  busy: boolean;
  copy: HomeAdvisorStatusCopy;
  onOpenHistory(): void;
  onRefresh(): void;
}) {
  const [open, setOpen] = useState(false);
  const status = presentAdvisorStatus(advisor, copy);
  if (!status) return null;
  const canRefresh = advisor.state !== 'refreshing';
  const refreshLabel = advisor.state === 'ready' ? copy.findAnother : copy.retry;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-9 max-w-56 rounded-lg px-2.5"
          aria-label={`${copy.label}：${status.label}`}
        >
          {status.refreshing ? (
            <RefreshCw className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Sparkles className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className={cn('size-1.5 shrink-0 rounded-full', toneClass[status.tone])} aria-hidden />
          <span className="truncate">{copy.label} · {status.label}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-[70] w-[min(21rem,calc(100vw-1.5rem))] rounded-xl border border-edge bg-surface-panel p-4 text-sm text-fg shadow-popover outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex items-start gap-3">
            <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              {status.refreshing ? (
                <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">{status.label}</p>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{status.detail}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-1 border-t border-edge-subtle pt-3">
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-lg text-xs"
              onClick={() => {
                setOpen(false);
                onOpenHistory();
              }}
            >
              <History className="size-3.5" aria-hidden />
              {copy.history}
            </Button>
            {canRefresh ? (
              <Button
                type="button"
                variant="secondary"
                className="h-9 rounded-lg text-xs"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onRefresh();
                }}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                {refreshLabel}
              </Button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
