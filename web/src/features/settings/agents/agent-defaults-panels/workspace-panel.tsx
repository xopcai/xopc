import { Folder } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName } from '../defaults-field-styles';

export function AgentDefaultsWorkspacePanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Folder} title={a.cardWorkspaceTitle} subtitle={a.cardWorkspaceSubtitle} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={a.label.workspace} description={a.desc.workspace}>
            <input
              type="text"
              className={inputClassName()}
              value={form.workspace}
              onChange={(e) => update({ workspace: e.target.value })}
              autoComplete="off"
            />
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
