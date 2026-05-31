import { WEBCHAT_AGENT_STORAGE_KEY } from '@/features/chat/session/chat-session-defaults';

import { AgentDeleteConfirmDialog } from './agent-delete-confirm-dialog';
import { agentsAppDetailPath } from './agents-app-path';
import { AgentsEditorModal } from './agents-editor-modal';
import { AgentsEditorPanelContent } from './agents-editor-panel-content';
import { AgentsListGrid } from './agents-list-grid';
import { AgentsSettingsHeader } from './agents-settings-header';
import { CreateAgentDialog } from './create-agent-dialog';
import { PRESET_AGENTS } from './preset-agents';
import { PresetAgentsSetup } from './preset-agents-setup';
import { useAgentsSettingsPanel } from './use-agents-settings-panel';

export function AgentsSettingsPanel() {
  const vm = useAgentsSettingsPanel();

  if (!vm.hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{vm.a.title}</h1>
        <p className="text-sm text-fg-muted">{vm.a.needToken}</p>
      </div>
    );
  }

  if (vm.showPresetSetup && vm.data) {
    const existingIds = new Set(vm.data.agents.map((ag) => ag.id));
    // Only show the preset setup when there's at least one preset available;
    // otherwise fall through to the main UI (showPresetSetup resets on next data refresh).
    const hasAvailablePresets = PRESET_AGENTS.some((p) => !existingIds.has(p.id));
    if (hasAvailablePresets) {
      return (
        <div className="mx-auto flex w-full max-w-app-main flex-col px-4 py-8">
          <PresetAgentsSetup
            existingAgentIds={existingIds}
            onComplete={vm.onPresetSetupComplete}
            onSkip={vm.onPresetSetupSkip}
          />
        </div>
      );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <AgentsSettingsHeader a={vm.a} />

      {vm.displayError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {vm.displayError}
        </div>
      ) : null}

      {vm.loading ? (
        <p className="text-sm text-fg-muted">{vm.a.loading}</p>
      ) : vm.data ? (
        <AgentsListGrid
          a={vm.a}
          agents={vm.data.agents}
          searchQuery={vm.listSearchQuery}
          onOpenAgent={(id) => vm.navigate(agentsAppDetailPath(id))}
          onChatWithAgent={(id) => {
            const agentId = id.trim().toLowerCase();
            try {
              globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, agentId);
            } catch {
              /* noop */
            }
            vm.navigate('/chat/new', { state: { agentId } });
          }}
          onNewAgent={vm.openAddAgentModal}
          busy={vm.busy}
        />
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
          onFooterSave={() => void vm.handleModalFooterSave()}
          footerSaveDisabled={vm.footerSaveDisabled}
          footerSavedFlash={vm.savedFlash}
          busy={vm.busy}
        >
          {vm.loading || !vm.data ? (
            <p className="text-sm text-fg-muted">{vm.a.loading}</p>
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
          }
        }}
        a={vm.a}
        chat={vm.chat}
        busy={vm.busy}
        modalError={vm.createModalError}
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
    </div>
  );
}
