import { Layers } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { TypedModelsEditor } from '../typed-models-editor';

export function AgentDefaultsTypedModelsSection(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader
        icon={Layers}
        title={a.label.typedModels}
        subtitle={a.desc.typedModels}
      />
      <div className="mt-4">
        <TypedModelsEditor
          rows={form.typedModels}
          chat={chat}
          onChange={(typedModels) => update({ typedModels })}
          labels={{
            id: a.typedModelIdLabel,
            description: a.typedModelDescriptionLabel,
            add: a.addTypedModel,
            remove: a.removeTypedModel,
            idPlaceholder: a.typedModelIdPlaceholder,
            descriptionPlaceholder: a.typedModelDescriptionPlaceholder,
          }}
        />
      </div>
    </SettingsFormSection>
  );
}
