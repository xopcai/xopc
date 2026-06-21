import { Play, Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import type { useWorkflowsPage } from './use-workflows-page';

export function WorkflowsPageHeaderActions({ vm }: { vm: ReturnType<typeof useWorkflowsPage> }) {
  const {
    labels,
    loading,
    refreshAll,
    setManageOpen,
    setPickStartOpen,
  } = vm;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button variant="primary" className="h-9 rounded-lg" onClick={() => setPickStartOpen(true)}>
        <Play className="size-4" aria-hidden />
        {labels.boardStart}
      </Button>
      <Button variant="secondary" className="h-9 rounded-lg" onClick={() => setManageOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {labels.addWorkflow}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="size-9 shrink-0 p-0"
        onClick={refreshAll}
        disabled={loading}
        title={labels.refresh}
        aria-label={labels.refresh}
      >
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} strokeWidth={1.75} aria-hidden />
      </Button>
    </div>
  );
}
