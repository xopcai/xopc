import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { RefreshButton } from '@/components/ui/refresh-button';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { messages } from '@/i18n/messages';

import type { useWorkflowsPage } from './use-workflows-page';

export function WorkflowsPageHeaderActions({ vm }: { vm: ReturnType<typeof useWorkflowsPage> }) {
  const {
    labels,
    language,
    loading,
    ownerAgentId,
    agentOptions,
    setOwnerAgentId,
    refreshAll,
  } = vm;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {agentOptions.length > 1 ? (
        <Select
          value={ownerAgentId ?? ''}
          aria-label={labels.agentFilterAria}
          onChange={(event) => setOwnerAgentId(event.target.value)}
          className="h-9 min-w-32 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface"
        >
          {agentOptions.map((agent) => (
            <SelectOption key={agent.id} value={agent.id}>
              {agentListDisplayName(agent, messages(language).agentsSettings)}
            </SelectOption>
          ))}
        </Select>
      ) : null}
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
