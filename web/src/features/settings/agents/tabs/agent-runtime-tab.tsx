import { FolderCog } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

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
  modelRows: AgentTypedModelRow[];
  setModelRows: Dispatch<SetStateAction<AgentTypedModelRow[]>>;
  onSaveModels: () => void;
  onClearModelsEntry: () => void;
}) {
  const {
    a,
    chat,
    selected,
    busy,
    editWorkspace,
    setEditWorkspace,
    modelRows,
    setModelRows,
    onSaveModels,
    onClearModelsEntry,
  } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={FolderCog}
          title={a.runtimeWorkspaceTitle}
          subtitle={a.runtimeWorkspaceHint}
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
          hideInlineSave
        />
      </section>
    </div>
  );
}
