import { Folder } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import { SettingsAdvancedGate } from '@/features/settings/settings-advanced-gate';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { DEFAULT_AGENT_WORKSPACE } from '@/features/settings/suggest-agent-workspace';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { agentDefaultsQuickActionButtonClass, inputClassName } from '../defaults-field-styles';

export function AgentDefaultsWorkspacePanel(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;
  const workspaceTrimmed = form.workspace.trim();
  const isDefaultWorkspace = workspaceTrimmed === DEFAULT_AGENT_WORKSPACE;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Folder} title={a.cardWorkspaceTitle} subtitle={a.cardWorkspaceSubtitle} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={a.label.workspace} description={a.desc.workspace}>
            <DirectoryPickerPathField
              value={form.workspace}
              onChange={(path) => update({ workspace: path })}
              wd={chat.workingDirectory}
              placeholder={chat.workingDirectory.notSet}
              inputClassName={inputClassName()}
              trailing={
                <Button
                  type="button"
                  variant="secondary"
                  className={agentDefaultsQuickActionButtonClass}
                  disabled={isDefaultWorkspace}
                  title={DEFAULT_AGENT_WORKSPACE}
                  onClick={() => update({ workspace: DEFAULT_AGENT_WORKSPACE })}
                >
                  {a.setDefaultWorkspace}
                </Button>
              }
            />
          </AgentDefaultsField>
          <SettingsAdvancedGate>
            <AgentDefaultsField label={a.label.mediaMaxMb} description={a.desc.mediaMaxMb}>
              <input
                type="number"
                min={1}
                step={1}
                className={inputClassName()}
                value={form.mediaMaxMb ?? ''}
                placeholder="20"
                onChange={(e) => {
                  const v = e.target.value;
                  update({ mediaMaxMb: v === '' ? undefined : Number(v) });
                }}
              />
            </AgentDefaultsField>
          </SettingsAdvancedGate>
        </div>
      </SettingsFormSection>
    </div>
  );
}
