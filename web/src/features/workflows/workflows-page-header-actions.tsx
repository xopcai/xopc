import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';

import type { useWorkflowsPage } from './use-workflows-page';

export function WorkflowsPageHeaderActions({ vm }: { vm: ReturnType<typeof useWorkflowsPage> }) {
  const {
    labels,
    loading,
    refreshAll,
  } = vm;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button asChild variant="primary" className="h-9 rounded-lg">
        <Link to="/workflows/new">
          <Plus className="size-4" aria-hidden />
          {labels.addWorkflow}
        </Link>
      </Button>
      <RefreshButton className="size-9 shrink-0 p-0" loading={loading} label={labels.refresh} onClick={refreshAll} />
    </div>
  );
}
