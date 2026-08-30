import { rememberSelectedAgent } from '@/features/chat/session/new-session-preferences';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';

import { AgentDeleteConfirmDialog } from './agent-delete-confirm-dialog';
import { agentsAppDetailPath } from './agents-app-path';
import { AgentsEditorModal } from './agents-editor-modal';
import { AgentsEditorPanelContent } from './agents-editor-panel-content';
import { AgentsListGrid } from './agents-list-grid';
import { CreateAgentDialog } from './create-agent-dialog';
import { useAgentsSettingsPanel } from './use-agents-settings-panel';

function AgentsSettingsSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-surface-base p-4 shadow-surface">
            <div className="flex items-start gap-3">
              <Skeleton className="size-11 rounded-xl" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            </div>
            <Skeleton className="mt-4 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentsSettingsPanel() {
  const vm = useAgentsSettingsPanel();

  if (!vm.hasToken) {
    return (
      <SettingsPageFrame gap="gap-3" padding="px-3 py-8 sm:px-5 xl:px-6" className="min-h-full bg-surface-panel">
        <SettingsPageHeader title={vm.a.title} />
        <p className="text-sm text-fg-muted">{vm.a.needToken}</p>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame gap="gap-6" padding="px-3 py-8 sm:px-5 xl:px-6" className="min-h-full bg-surface-panel">
      {vm.displayError ? (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 shadow-surface dark:text-red-300">
          {vm.displayError}
        </div>
      ) : null}

      {vm.loading ? (
        <AgentsSettingsSkeleton />
      ) : vm.data ? (
        <div className="flex flex-col gap-4">
          <AgentsListGrid
            a={vm.a}
            agents={vm.data.agents}
            defaultAgentId={vm.data.defaultId}
            tuiDefaultAgentId={vm.effectiveTuiDefaultAgentId}
            tuiDefaultInherited={!vm.savedTuiDefaultAgentId || vm.tuiDefaultAgentUnavailable}
            searchQuery={vm.listSearchQuery}
            onOpenAgent={(id) => vm.navigate(agentsAppDetailPath(id))}
            onChatWithAgent={(id) => {
              const agentId = id.trim().toLowerCase();
              rememberSelectedAgent(agentId);
              vm.navigate('/chat/new?projectScope=none', { state: { agentId } });
            }}
            busy={vm.busy}
          />
        </div>
      ) : null}

      {vm.routeAgentId && vm.hasToken ? (
        <AgentsEditorModal
          open={Boolean(vm.routeAgentId)}
          onOpenChange={vm.onAgentModalOpenChange}
          a={vm.a}
          title={vm.modalTitle}
          subtitle={vm.modalSubtitle}
          panel={vm.panel}
          onPanelChange={vm.setPanel}
        >
          {vm.loading || !vm.data ? (
            <AgentsSettingsSkeleton />
          ) : (
            <AgentsEditorPanelContent {...vm.editorPanelProps} />
          )}
        </AgentsEditorModal>
      ) : null}

      <CreateAgentDialog
        open={vm.addAgentModalOpen}
        onOpenChange={(open) => {
          vm.setAddAgentModalOpen(open);
          if (!open) {
            vm.createWorkspaceSuggestedRef.current = '';
            vm.setCreateDisplayName('');
            vm.setCreateAgentId('');
            vm.setCreateDescription('');
            vm.setCreateWorkspace('');
            vm.setCreateModel('');
            vm.setCreateModalError(null);
            vm.onSelectDuplicateSource(null);
            vm.setCreatePresetIds([]);
          }
        }}
        a={vm.a}
        chat={vm.chat}
        busy={vm.busy}
        modalError={vm.createModalError}
        profileLanguageLabel={vm.currentLanguageLabel}
        createDisplayName={vm.createDisplayName}
        setCreateDisplayName={vm.setCreateDisplayName}
        createAgentId={vm.createAgentId}
        setCreateAgentId={vm.setCreateAgentId}
        createDescription={vm.createDescription}
        setCreateDescription={vm.setCreateDescription}
        createWorkspace={vm.createWorkspace}
        setCreateWorkspace={vm.setCreateWorkspace}
        createModel={vm.createModel}
        setCreateModel={vm.setCreateModel}
        onCreate={vm.onCreate}
        onSuggestWorkspace={() => vm.applyCreateWorkspaceSuggestion()}
        agents={vm.data?.agents ?? []}
        duplicateSourceId={vm.duplicateSourceId}
        onSelectDuplicateSource={vm.onSelectDuplicateSource}
        capabilityPlans={vm.editorPanelProps.capabilityPresets}
        defaultPresetId={vm.editorPanelProps.defaultPresetId ?? 'default'}
        selectedCapabilityPlanIds={vm.createPresetIds}
        onSelectedCapabilityPlanIdsChange={vm.setCreatePresetIds}
      />

      <AgentDeleteConfirmDialog
        open={vm.deleteDialogOpen}
        onOpenChange={(open) => {
          vm.setDeleteDialogOpen(open);
          if (!open) {
            vm.setDeleteTarget(null);
            vm.setDeleteConfirmText('');
          }
        }}
        busy={vm.busy}
        deletePurge={vm.deletePurge}
        deleteTarget={vm.deleteTarget}
        deleteConfirmText={vm.deleteConfirmText}
        onDeleteConfirmTextChange={vm.setDeleteConfirmText}
        onConfirm={() => {
          if (!vm.deleteTarget) return;
          void vm.performDelete(vm.deleteTarget, vm.deletePurge);
        }}
        onCancel={() => vm.setDeleteDialogOpen(false)}
        a={vm.a}
      />
    </SettingsPageFrame>
  );
}
