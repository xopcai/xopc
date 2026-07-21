import type { Dispatch, FormEvent, SetStateAction } from 'react';

import type { ChannelStatus, SessionChatId } from '@/features/settings/channel-recipient-api';
import type {
  fetchAgentProfileFiles,
  GatewayAgentRow,
  GatewayAgentsPayload,
  GatewayConfigBinding,
  SkillCatalogRow,
} from '@/features/settings/agents-admin-api';
import type { CapabilityPresetRow } from '@/features/settings/capability-presets/capability-presets-api';
import type { AgentsSettingsMessages, ChatMessages, MessageBundle } from '@/i18n/messages';

import { AgentDangerZoneTab } from './tabs/agent-advanced-tab';
import { AgentAdvancedPanel } from './tabs/agent-advanced-panel';
import { AgentCapabilitiesTab } from './tabs/agent-capabilities-tab';
import { AgentChannelsTab } from './tabs/agent-channels-tab';
import { AgentOverviewTab } from './tabs/agent-overview-tab';
import { AgentOverviewSummaryTab } from './tabs/agent-overview-summary-tab';
import { AgentRuntimeTab } from './tabs/agent-runtime-tab';
import type { OverviewProfileDraft } from './hooks/use-agent-overview-profile-markdown';
import type { SoulTemplateId } from './agent-profile-markdown';
import type { AgentPanel } from './utils';
import type { AgentTypedModelRow } from './typed-models-lib';

type CronMessages = MessageBundle['cron'];

export type AgentsEditorPanelContentProps = {
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  cCron: CronMessages;
  selected: GatewayAgentRow | null;
  panel: AgentPanel;
  data: GatewayAgentsPayload | null;
  busy: boolean;
  editName: string;
  setEditName: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editWorkspace: string;
  setEditWorkspace: (v: string) => void;
  editModel: string;
  defaultModel: string;
  defaultWorkspace: string;
  onSetDefault: () => void;
  onSetTuiDefault: () => void;
  isTuiDefault: boolean;
  isTuiDefaultInherited: boolean;
  onDelete: (purge: boolean) => void;
  capabilityPresets: CapabilityPresetRow[];
  defaultPresetId?: string;
  onUpdateAgentExtends: (nextExtends: string[]) => void;
  onOpenCapabilityPreset: (presetId: string) => void;
  overviewProfile: {
    profileMarkdownLoading: boolean;
    draft: OverviewProfileDraft | null;
    updateIdentity: (patch: Partial<OverviewProfileDraft['identity']>) => void;
    handleSoulTemplateChange: (templateId: SoulTemplateId) => void;
    handleSoulContentChange: (content: string) => void;
    setAvatarDialogOpen: (open: boolean) => void;
    toggleSoulPreviewMode: () => void;
  };
  filesLoading: boolean;
  files: Awaited<ReturnType<typeof fetchAgentProfileFiles>> | null;
  activeFile: string | null;
  setActiveFile: (v: string | null) => void;
  filesViewMode: 'edit' | 'preview';
  setFilesViewMode: (v: 'edit' | 'preview') => void;
  fileDraft: string;
  setFileDraft: (v: string) => void;
  fileSaving: boolean;
  profileFileLoading: boolean;
  profileEditorNonce: number;
  toolEntryDisable: Set<string>;
  setToolEntryDisable: Dispatch<SetStateAction<Set<string>>>;
  onSaveTools: () => void;
  onClearToolsEntry: () => void;
  modelRows: AgentTypedModelRow[];
  setModelRows: Dispatch<SetStateAction<AgentTypedModelRow[]>>;
  onSaveModels: () => void;
  onClearModelsEntry: () => void;
  skillsCatalogLoading: boolean;
  catalogForPick: SkillCatalogRow[];
  skillsInherit: boolean;
  setSkillsInherit: (v: boolean) => void;
  skillsPick: Set<string>;
  setSkillsPick: Dispatch<SetStateAction<Set<string>>>;
  onSaveSkills: () => void;
  bindingsLoading: boolean;
  agentBindings: GatewayConfigBinding[];
  bindChannelStatuses: ChannelStatus[];
  bindChannelsLoading: boolean;
  useManualChannel: boolean;
  newBindChannel: string;
  setNewBindChannel: (v: string) => void;
  bindSessionChats: SessionChatId[];
  bindSessionsLoading: boolean;
  newBindSessionIdx: number | null;
  setNewBindSessionIdx: Dispatch<SetStateAction<number | null>>;
  newBindCustomPeer: string;
  setNewBindCustomPeer: (v: string) => void;
  refreshBindSessions: () => void;
  onRemoveBinding: (rule: GatewayConfigBinding) => void;
  onAddBinding: (e: FormEvent) => void;
  onTryInChat?: () => void;
};

export function AgentsEditorPanelContent({
  a,
  chat,
  cCron,
  selected,
  panel,
  data,
  busy,
  editName,
  setEditName,
  editDescription,
  setEditDescription,
  editWorkspace,
  setEditWorkspace,
  editModel,
  defaultModel,
  defaultWorkspace,
  onSetDefault,
  onSetTuiDefault,
  isTuiDefault,
  isTuiDefaultInherited,
  onDelete,
  capabilityPresets,
  defaultPresetId,
  onUpdateAgentExtends,
  onOpenCapabilityPreset,
  overviewProfile,
  filesLoading,
  files,
  activeFile,
  setActiveFile,
  filesViewMode,
  setFilesViewMode,
  fileDraft,
  setFileDraft,
  fileSaving,
  profileFileLoading,
  profileEditorNonce,
  toolEntryDisable,
  setToolEntryDisable,
  onSaveTools,
  onClearToolsEntry,
  modelRows,
  setModelRows,
  onSaveModels,
  onClearModelsEntry,
  skillsCatalogLoading,
  catalogForPick,
  skillsInherit,
  setSkillsInherit,
  skillsPick,
  setSkillsPick,
  onSaveSkills,
  bindingsLoading,
  agentBindings,
  bindChannelStatuses,
  bindChannelsLoading,
  useManualChannel,
  newBindChannel,
  setNewBindChannel,
  bindSessionChats,
  bindSessionsLoading,
  newBindSessionIdx,
  setNewBindSessionIdx,
  newBindCustomPeer,
  setNewBindCustomPeer,
  refreshBindSessions,
  onRemoveBinding,
  onAddBinding,
  onTryInChat,
}: AgentsEditorPanelContentProps) {
  if (!selected) {
    return <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>;
  }

  if (panel === 'overview') {
    return (
      <AgentOverviewSummaryTab
        a={a}
        selected={selected}
        defaultModel={defaultModel}
        defaultWorkspace={defaultWorkspace}
        isTuiDefault={isTuiDefault}
        isTuiDefaultInherited={isTuiDefaultInherited}
        busy={busy}
        onSetDefault={onSetDefault}
        onSetTuiDefault={onSetTuiDefault}
        onTryInChat={onTryInChat}
      />
    );
  }

  if (panel === 'profile') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentOverviewTab
          a={a}
          selected={selected}
          busy={busy}
          editName={editName}
          setEditName={setEditName}
          editDescription={editDescription}
          setEditDescription={setEditDescription}
          profileMarkdownLoading={overviewProfile.profileMarkdownLoading}
          profileDraft={overviewProfile.draft}
          updateIdentity={overviewProfile.updateIdentity}
          handleSoulTemplateChange={overviewProfile.handleSoulTemplateChange}
          handleSoulContentChange={overviewProfile.handleSoulContentChange}
          setAvatarDialogOpen={overviewProfile.setAvatarDialogOpen}
          toggleSoulPreviewMode={overviewProfile.toggleSoulPreviewMode}
        />
      </div>
    );
  }

  if (panel === 'capabilities') {
    return (
      <AgentCapabilitiesTab
        a={a}
        data={data!}
        selected={selected}
        busy={busy}
        toolEntryDisable={toolEntryDisable}
        setToolEntryDisable={setToolEntryDisable}
        onSaveTools={onSaveTools}
        onClearToolsEntry={onClearToolsEntry}
        skillsCatalogLoading={skillsCatalogLoading}
        catalogForPick={catalogForPick}
        skillsInherit={skillsInherit}
        setSkillsInherit={setSkillsInherit}
        skillsPick={skillsPick}
        setSkillsPick={setSkillsPick}
        onSaveSkills={onSaveSkills}
      />
    );
  }

  if (panel === 'runtime') {
    return (
      <AgentRuntimeTab
        a={a}
        chat={chat}
        selected={selected}
        busy={busy}
        editWorkspace={editWorkspace}
        setEditWorkspace={setEditWorkspace}
        modelRows={modelRows}
        setModelRows={setModelRows}
        onSaveModels={onSaveModels}
        onClearModelsEntry={onClearModelsEntry}
      />
    );
  }

  if (panel === 'connections') {
    return (
      <AgentChannelsTab
        a={a}
        busy={busy}
        bindingsLoading={bindingsLoading}
        agentBindings={agentBindings}
        channelStatuses={bindChannelStatuses}
        channelsStatusLoading={bindChannelsLoading}
        useManualChannel={useManualChannel}
        newBindChannel={newBindChannel}
        setNewBindChannel={setNewBindChannel}
        bindSessionChats={bindSessionChats}
        sessionsLoading={bindSessionsLoading}
        newBindSessionIdx={newBindSessionIdx}
        setNewBindSessionIdx={setNewBindSessionIdx}
        newBindCustomPeer={newBindCustomPeer}
        setNewBindCustomPeer={setNewBindCustomPeer}
        onRefreshSessions={refreshBindSessions}
        lastActiveLabels={cCron.lastActiveLabels}
        selectRecipient={cCron.selectRecipient}
        onRemoveBinding={onRemoveBinding}
        onAddBinding={onAddBinding}
      />
    );
  }

  if (panel === 'advanced') {
    return (
      <AgentAdvancedPanel
        a={a}
        selected={selected}
        busy={busy}
        defaultModel={defaultModel}
        defaultWorkspace={defaultWorkspace}
        agentModel={editModel}
        agentWorkspace={editWorkspace}
        capabilityPresets={capabilityPresets}
        defaultPresetId={defaultPresetId}
        onUpdateAgentExtends={onUpdateAgentExtends}
        onOpenCapabilityPreset={onOpenCapabilityPreset}
        filesLoading={filesLoading}
        files={files}
        activeFile={activeFile}
        setActiveFile={setActiveFile}
        filesViewMode={filesViewMode}
        setFilesViewMode={setFilesViewMode}
        fileDraft={fileDraft}
        setFileDraft={setFileDraft}
        fileSaving={fileSaving}
        profileFileLoading={profileFileLoading}
        profileEditorNonce={profileEditorNonce}
        onTryInChat={onTryInChat}
      />
    );
  }

  if (panel === 'dangerZone') {
    return (
      <AgentDangerZoneTab
        a={a}
        selected={selected}
        busy={busy}
        onDelete={onDelete}
      />
    );
  }

  return <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>;
}
