import type { Dispatch, FormEvent, MutableRefObject, SetStateAction } from 'react';

import type { ChannelStatus, CronJob, SessionChatId } from '@/features/cron/cron-api';
import type {
  fetchAgentProfileFiles,
  GatewayAgentRow,
  GatewayAgentsPayload,
  GatewayConfigBinding,
  SkillCatalogRow,
} from '@/features/settings/agents-admin-api';
import type { CapabilityPresetRow } from '@/features/settings/capability-presets/capability-presets-api';
import type { AgentsSettingsMessages, ChatMessages, MessageBundle } from '@/i18n/messages';
import { MemoryPage } from '@/pages/memory-page';

import { AgentChannelsTab } from './tabs/agent-channels-tab';
import { AgentCronTab } from './tabs/agent-cron-tab';
import { AgentEffectiveCapabilityTab } from './tabs/agent-effective-capability-tab';
import { AgentFilesTab } from './tabs/agent-files-tab';
import { AgentModelsTab } from './tabs/agent-models-tab';
import { AgentOverviewTab } from './tabs/agent-overview-tab';
import { AgentSkillsTab } from './tabs/agent-skills-tab';
import { AgentToolsTab } from './tabs/agent-tools-tab';
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
  setEditModel: (v: string) => void;
  defaultModel: string;
  defaultWorkspace: string;
  onSetDefault: () => void;
  onSaveAgentEdits: () => void;
  onDelete: (purge: boolean) => void;
  capabilityPresets: CapabilityPresetRow[];
  onUpdateAgentExtends: (nextExtends: string[]) => void;
  onOpenCapabilityPreset: (presetId: string) => void;
  overviewSaveProfileMarkdownRef: MutableRefObject<(() => Promise<void>) | null>;
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
  cronLoading: boolean;
  agentCronJobs: CronJob[];
  onSetCronJobAgent: (job: CronJob, agentKey: string) => void;
  onTryInChat?: () => void;
  onPanelChange?: (panel: AgentPanel) => void;
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
  setEditModel,
  defaultModel,
  defaultWorkspace,
  onSetDefault,
  onSaveAgentEdits,
  onDelete,
  capabilityPresets,
  onUpdateAgentExtends,
  onOpenCapabilityPreset,
  overviewSaveProfileMarkdownRef: _overviewSaveProfileMarkdownRef,
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
  cronLoading,
  agentCronJobs,
  onSetCronJobAgent,
  onTryInChat,
  onPanelChange,
}: AgentsEditorPanelContentProps) {
  if (!selected) {
    return <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>;
  }

  if (panel === 'overview') {
    return (
      <AgentOverviewTab
        a={a}
        chat={chat}
        selected={selected}
        busy={busy}
        editName={editName}
        setEditName={setEditName}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editWorkspace={editWorkspace}
        setEditWorkspace={setEditWorkspace}
        editModel={editModel}
        setEditModel={setEditModel}
        onSetDefault={onSetDefault}
        onSaveAgentEdits={onSaveAgentEdits}
        onDelete={onDelete}
        capabilityPresets={capabilityPresets}
        onUpdateAgentExtends={onUpdateAgentExtends}
        onOpenCapabilityPreset={onOpenCapabilityPreset}
        hideInlineSave
        profileMarkdownLoading={overviewProfile.profileMarkdownLoading}
        profileDraft={overviewProfile.draft}
        updateIdentity={overviewProfile.updateIdentity}
        handleSoulTemplateChange={overviewProfile.handleSoulTemplateChange}
        handleSoulContentChange={overviewProfile.handleSoulContentChange}
        setAvatarDialogOpen={overviewProfile.setAvatarDialogOpen}
        toggleSoulPreviewMode={overviewProfile.toggleSoulPreviewMode}
        defaultModel={defaultModel}
        defaultWorkspace={defaultWorkspace}
        onTryInChat={onTryInChat}
        onEditModelStrategy={() => onPanelChange?.('models')}
      />
    );
  }

  if (panel === 'files') {
    return (
      <AgentFilesTab
        a={a}
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

  if (panel === 'tools') {
    return (
      <AgentToolsTab
        a={a}
        data={data!}
        selected={selected}
        busy={busy}
        toolEntryDisable={toolEntryDisable}
        setToolEntryDisable={setToolEntryDisable}
        onSaveTools={onSaveTools}
        onClearToolsEntry={onClearToolsEntry}
        hideInlineSave
      />
    );
  }

  if (panel === 'models') {
    return (
      <AgentModelsTab
        a={a}
        chat={chat}
        selected={selected}
        busy={busy}
        modelRows={modelRows}
        setModelRows={setModelRows}
        onSaveModels={onSaveModels}
        onClearModelsEntry={onClearModelsEntry}
        hideInlineSave
      />
    );
  }

  if (panel === 'skills') {
    return (
      <AgentSkillsTab
        a={a}
        selected={selected}
        busy={busy}
        skillsCatalogLoading={skillsCatalogLoading}
        catalogForPick={catalogForPick}
        skillsInherit={skillsInherit}
        setSkillsInherit={setSkillsInherit}
        skillsPick={skillsPick}
        setSkillsPick={setSkillsPick}
        onSaveSkills={onSaveSkills}
        hideInlineSave
      />
    );
  }

  if (panel === 'memory') {
    return <MemoryPage embedded agentId={selected.id} />;
  }

  if (panel === 'effective') {
    return <AgentEffectiveCapabilityTab a={a} selected={selected} />;
  }

  if (panel === 'channels') {
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

  if (panel === 'cron' && data) {
    return (
      <AgentCronTab
        a={a}
        data={data}
        selected={selected}
        busy={busy}
        cronLoading={cronLoading}
        agentCronJobs={agentCronJobs}
        onSetCronJobAgent={onSetCronJobAgent}
      />
    );
  }

  return <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>;
}
