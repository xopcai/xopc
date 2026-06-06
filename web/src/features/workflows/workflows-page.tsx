import { WorkflowsPageView } from '@/features/workflows/workflows-page-view';
import { useWorkflowsPage } from '@/features/workflows/use-workflows-page';

export function WorkflowsPage() {
  const vm = useWorkflowsPage();
  return <WorkflowsPageView vm={vm} />;
}
