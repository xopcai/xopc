import { Layers } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';

import { TypedModelsEditor } from '../typed-models-editor';
import { formatTypedModelsSummary, type AgentTypedModelRow } from '../typed-models-lib';

export function AgentModelsTab(props: {
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  modelRows: AgentTypedModelRow[];
  setModelRows: Dispatch<SetStateAction<AgentTypedModelRow[]>>;
  onSaveModels: () => void;
  onClearModelsEntry: () => void;
  hideInlineSave?: boolean;
}) {
  const {
    a,
    chat,
    selected,
    busy,
    modelRows,
    setModelRows,
    onSaveModels,
    onClearModelsEntry,
    hideInlineSave,
  } = props;

  return (
    <SettingsFormSection className="flex min-h-0 flex-1 flex-col">
      <SettingsFormSectionHeader
        className="shrink-0"
        icon={Layers}
        title={a.modelsTabTitle}
        subtitle={a.modelsTabHint}
      />
      <div className="mb-4 grid gap-2 rounded-lg border border-edge-subtle bg-surface-base/60 p-3 text-xs text-fg-muted dark:border-edge">
        <div>
          <span className="font-medium text-fg">{a.modelsPresetLabel}</span>{' '}
          {formatTypedModelsSummary(selected.typedModels.preset)}
        </div>
        <div>
          <span className="font-medium text-fg">{a.modelsEffectiveLabel}</span>{' '}
          {formatTypedModelsSummary(selected.typedModels.effective)}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <TypedModelsEditor
          rows={modelRows}
          onChange={setModelRows}
          disabled={busy}
          defaultRole={selected.typedModels.defaultRole}
          chat={chat}
          labels={{
            id: a.typedModelIdLabel,
            description: a.typedModelDescriptionLabel,
            add: a.addTypedModel,
            remove: a.removeTypedModel,
            recommendedTitle: a.typedModelRecommendedTitle,
            customTitle: a.typedModelCustomTitle,
            defaultBadge: a.typedModelDefaultBadge,
            addPurpose: a.addTypedModelPurpose,
            noCustomRoles: a.typedModelNoCustomRoles,
            idPlaceholder: a.typedModelIdPlaceholder,
            descriptionPlaceholder: a.typedModelDescriptionPlaceholder,
            roleNames: a.typedModelRoleNames,
            roleDescriptions: a.typedModelRoleDescriptions,
          }}
        />
      </div>
      <div className="mt-4 flex shrink-0 flex-wrap gap-2">
        {!hideInlineSave ? (
          <Button type="button" disabled={busy} onClick={() => void onSaveModels()}>
            {a.modelsSave}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void onClearModelsEntry()}>
          {a.modelsResetInherit}
        </Button>
      </div>
    </SettingsFormSection>
  );
}
