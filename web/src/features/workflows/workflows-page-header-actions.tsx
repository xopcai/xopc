import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, MessageCircle, Pencil, Plus } from 'lucide-react';

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
    startWorkflowCreation,
    openManualWorkflowCreator,
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
      <RefreshButton className="size-9 shrink-0 p-0" loading={loading} label={labels.refresh} onClick={refreshAll} />
      <div className="inline-flex h-9 shrink-0" role="group" aria-label={labels.createOptions}>
        <Button variant="primary" className="h-9 rounded-r-none pr-2.5" onClick={startWorkflowCreation}>
          <Plus className="size-4" aria-hidden />
          {labels.addWorkflow}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="primary"
              className="h-9 w-9 rounded-l-none border-l border-white/20 px-0"
              aria-label={labels.createOptions}
              title={labels.createOptions}
            >
              <ChevronDown className="size-4" aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className="z-70 min-w-52 rounded-xl border border-edge bg-surface-panel p-1 shadow-popover">
              <DropdownMenu.Item
                className="touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover"
                onSelect={startWorkflowCreation}
              >
                <MessageCircle className="size-4 text-fg-muted" aria-hidden />
                {labels.createWithAssistant}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover"
                onSelect={openManualWorkflowCreator}
              >
                <Pencil className="size-4 text-fg-muted" aria-hidden />
                {labels.setUpManually}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
