import { Folder } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DirectoryPickerField } from '@/features/fs/directory-picker-field';
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <DirectoryPickerField
                  value={form.workspace}
                  onChange={(path) => update({ workspace: path })}
                  wd={chat.workingDirectory}
                  placeholder={chat.workingDirectory.notSet}
                  maxWidthClass="max-w-full sm:max-w-[min(20rem,100%)]"
                />
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
              </div>
              <input
                type="text"
                className={inputClassName()}
                value={form.workspace}
                onChange={(e) => update({ workspace: e.target.value })}
                placeholder={chat.workingDirectory.pathInputPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </AgentDefaultsField>
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
        </div>
      </SettingsFormSection>
    </div>
  );
}
