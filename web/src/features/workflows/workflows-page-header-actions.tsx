import { Play, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';

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
      <RefreshButton className="size-9 shrink-0 p-0" loading={loading} label={labels.refresh} onClick={refreshAll} />
    </div>
  );
}
