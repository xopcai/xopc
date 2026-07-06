import { WEBCHAT_AGENT_STORAGE_KEY } from '@/features/chat/session/chat-session-defaults';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';

import { AgentDeleteConfirmDialog } from './agent-delete-confirm-dialog';
import { agentsAppDetailPath } from './agents-app-path';
import { AgentsEditorModal } from './agents-editor-modal';
import { AgentsEditorPanelContent } from './agents-editor-panel-content';
import { AgentsListGrid } from './agents-list-grid';
import { CreateAgentDialog } from './create-agent-dialog';
import { useAgentsSettingsPanel } from './use-agents-settings-panel';

export function AgentsSettingsPanel() {
  const vm = useAgentsSettingsPanel();

  if (!vm.hasToken) {
    return (
      <SettingsPageFrame gap="gap-3" padding="px-3 py-8 sm:px-5 xl:px-6">
        <SettingsPageHeader title={vm.a.title} />
        <p className="text-sm text-fg-muted">{vm.a.needToken}</p>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame gap="gap-6" padding="px-3 py-8 sm:px-5 xl:px-6">
      {vm.displayError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {vm.displayError}
        </div>
      ) : null}

      {vm.loading ? (
        <p className="text-sm text-fg-muted">{vm.a.loading}</p>
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
              try {
                globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, agentId);
              } catch {
                /* noop */
              }
              vm.navigate('/chat/new', { state: { agentId } });
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
          onFooterSave={() => void vm.handleModalFooterSave()}
          footerSaveDisabled={vm.footerSaveDisabled}
          footerSavedFlash={vm.savedFlash}
          showFooter={vm.panel === 'behavior'}
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
            vm.onSelectDuplicateSource(null);
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
