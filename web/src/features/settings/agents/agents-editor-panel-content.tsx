import type { Dispatch, FormEvent, MutableRefObject, SetStateAction } from 'react';

import type { ChannelStatus, CronJob, SessionChatId } from '@/features/cron/cron-api';
import type {
  fetchAgentBootstrapFiles,
  GatewayAgentRow,
  GatewayAgentsPayload,
  GatewayConfigBinding,
  SkillCatalogRow,
} from '@/features/settings/agents-admin-api';
import type { AgentsSettingsMessages, ChatMessages, MessageBundle } from '@/i18n/messages';

import { AgentChannelsTab } from './tabs/agent-channels-tab';
import { AgentCronTab } from './tabs/agent-cron-tab';
import { AgentFilesTab } from './tabs/agent-files-tab';
import { AgentOverviewTab } from './tabs/agent-overview-tab';
import { AgentProfileTab } from './tabs/agent-profile-tab';
import { AgentSkillsTab } from './tabs/agent-skills-tab';
import { AgentToolsTab } from './tabs/agent-tools-tab';
import type { AgentPanel } from './utils';

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
  onSetDefault: () => void;
  onSaveAgentEdits: () => void;
  onDelete: (purge: boolean) => void;
  overviewSaveBootstrapRef: MutableRefObject<(() => Promise<void>) | null>;
  profileSaveRef: MutableRefObject<(() => Promise<void>) | null>;
  setOverviewBootstrapDirty: (v: boolean) => void;
  setProfileDirty: (v: boolean) => void;
  filesLoading: boolean;
  files: Awaited<ReturnType<typeof fetchAgentBootstrapFiles>> | null;
  activeFile: string | null;
  setActiveFile: (v: string | null) => void;
  bootstrapViewMode: 'edit' | 'preview';
  setBootstrapViewMode: (v: 'edit' | 'preview') => void;
  fileDraft: string;
  setFileDraft: (v: string) => void;
  fileSaving: boolean;
  bootstrapFileLoading: boolean;
  bootstrapEditorNonce: number;
  toolEntryDisable: Set<string>;
  setToolEntryDisable: Dispatch<SetStateAction<Set<string>>>;
  onSaveTools: () => void;
  onClearToolsEntry: () => void;
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
  onSetDefault,
  onSaveAgentEdits,
  onDelete,
  overviewSaveBootstrapRef,
  profileSaveRef,
  setOverviewBootstrapDirty,
  setProfileDirty,
  filesLoading,
  files,
  activeFile,
  setActiveFile,
  bootstrapViewMode,
  setBootstrapViewMode,
  fileDraft,
  setFileDraft,
  fileSaving,
  bootstrapFileLoading,
  bootstrapEditorNonce,
  toolEntryDisable,
  setToolEntryDisable,
  onSaveTools,
  onClearToolsEntry,
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
        hideInlineSave
        saveBootstrapRef={overviewSaveBootstrapRef}
        onBootstrapDirtyChange={setOverviewBootstrapDirty}
      />
    );
  }

  if (panel === 'profile') {
    return (
      <AgentProfileTab a={a} agentId={selected.id} saveRef={profileSaveRef} onDirtyChange={setProfileDirty} />
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
        bootstrapViewMode={bootstrapViewMode}
        setBootstrapViewMode={setBootstrapViewMode}
        fileDraft={fileDraft}
        setFileDraft={setFileDraft}
        fileSaving={fileSaving}
        bootstrapFileLoading={bootstrapFileLoading}
        bootstrapEditorNonce={bootstrapEditorNonce}
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
