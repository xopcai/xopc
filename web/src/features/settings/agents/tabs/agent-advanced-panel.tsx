import { FileCode2, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { PageTabs } from '@/components/ui/page-tabs';
import type { fetchAgentProfileFiles, GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { CapabilityPresetRow } from '@/features/settings/capability-presets/capability-presets-api';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import { AgentConfigTab } from './agent-advanced-tab';
import { AgentFilesTab } from './agent-files-tab';

type AdvancedTab = 'files' | 'config';

export function AgentAdvancedPanel(props: {
  a: AgentsSettingsMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  defaultModel: string;
  defaultWorkspace: string;
  agentModel: string;
  agentWorkspace: string;
  capabilityPresets: CapabilityPresetRow[];
  defaultPresetId?: string;
  onUpdateAgentExtends: (nextExtends: string[]) => void;
  onOpenCapabilityPreset: (presetId: string) => void;
  filesLoading: boolean;
  files: Awaited<ReturnType<typeof fetchAgentProfileFiles>> | null;
  activeFile: string | null;
  setActiveFile: (value: string) => void;
  filesViewMode: 'edit' | 'preview';
  setFilesViewMode: (value: 'edit' | 'preview') => void;
  fileDraft: string;
  setFileDraft: (value: string) => void;
  fileSaving: boolean;
  profileFileLoading: boolean;
  profileEditorNonce: number;
  onTryInChat?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<AdvancedTab>('files');
  const { a } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="mb-3 max-w-[70ch] text-sm leading-6 text-fg-muted">{a.advancedHint}</p>
        <PageTabs
          items={[
            { id: 'files', label: a.advancedFilesTab, icon: FileCode2 },
            { id: 'config', label: a.advancedConfigTab, icon: SlidersHorizontal },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel={a.advancedNavAria}
          tabIdPrefix="agent-advanced-tab"
          panelIdPrefix="agent-advanced-panel"
        />
      </div>

      {activeTab === 'files' ? (
        <AgentFilesTab
          a={a}
          filesLoading={props.filesLoading}
          files={props.files}
          activeFile={props.activeFile}
          setActiveFile={props.setActiveFile}
          filesViewMode={props.filesViewMode}
          setFilesViewMode={props.setFilesViewMode}
          fileDraft={props.fileDraft}
          setFileDraft={props.setFileDraft}
          fileSaving={props.fileSaving}
          profileFileLoading={props.profileFileLoading}
          profileEditorNonce={props.profileEditorNonce}
          onTryInChat={props.onTryInChat}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <p className="shrink-0 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-xs leading-5 text-fg-muted">
            {a.advancedRuntimeCoverageHint}
          </p>
          <AgentConfigTab
            a={a}
            selected={props.selected}
            busy={props.busy}
            defaultModel={props.defaultModel}
            defaultWorkspace={props.defaultWorkspace}
            agentModel={props.agentModel}
            agentWorkspace={props.agentWorkspace}
            capabilityPresets={props.capabilityPresets}
            defaultPresetId={props.defaultPresetId}
            onUpdateAgentExtends={props.onUpdateAgentExtends}
            onOpenCapabilityPreset={props.onOpenCapabilityPreset}
          />
        </div>
      )}
    </div>
  );
}
