import { FolderCog } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAutosave } from '@/lib/use-autosave';

import { agentsSettingsInputClass } from '../utils';
import type { AgentTypedModelRow } from '../typed-models-lib';
import { AgentModelsTab } from './agent-models-tab';

export function AgentRuntimeTab(props: {
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  editWorkspace: string;
  setEditWorkspace: (value: string) => void;
  onSaveWorkspace: (workspace: string) => Promise<void>;
  modelRows: AgentTypedModelRow[];
  setModelRows: Dispatch<SetStateAction<AgentTypedModelRow[]>>;
  onSaveModels: (rows: AgentTypedModelRow[]) => Promise<void>;
  onClearModelsEntry: () => void;
}) {
  const {
    a,
    chat,
    selected,
    busy,
    editWorkspace,
    setEditWorkspace,
    onSaveWorkspace,
    modelRows,
    setModelRows,
    onSaveModels,
    onClearModelsEntry,
  } = props;

  const workspaceDirty = editWorkspace.trim() !== selected.workspace;
  const workspaceAutosave = useAutosave({
    value: editWorkspace,
    dirty: workspaceDirty,
    onSave: onSaveWorkspace,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <SettingsFormSection onBlurCapture={workspaceAutosave.onBlurCapture}>
        <SettingsFormSectionHeader
          icon={FolderCog}
          title={a.runtimeWorkspaceTitle}
          subtitle={a.runtimeWorkspaceHint}
          trailing={<AutosaveStatus status={workspaceAutosave.status} error={workspaceAutosave.error} />}
        />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-fg">{a.workspacePath}</span>
          <DirectoryPickerPathField
            value={editWorkspace}
            onChange={setEditWorkspace}
            disabled={busy}
            wd={chat.workingDirectory}
            inputClassName={cn(agentsSettingsInputClass(), 'font-mono text-xs')}
          />
        </label>
      </SettingsFormSection>

      <section className="min-h-[34rem]">
        <AgentModelsTab
          a={a}
          chat={chat}
          selected={selected}
          busy={busy}
          modelRows={modelRows}
          setModelRows={setModelRows}
          onSaveModels={onSaveModels}
          onClearModelsEntry={onClearModelsEntry}
        />
      </section>
    </div>
  );
}
