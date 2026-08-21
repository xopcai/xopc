import { Layers, Settings2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { capabilitySettingsPath } from '@/navigation';
import { useAutosave } from '@/lib/use-autosave';

import { TypedModelsEditor } from '../typed-models-editor';
import {
  cleanTypedModelsForPatch,
  formatTypedModelsSummary,
  typedModelsRowsFromList,
  type AgentTypedModelRow,
} from '../typed-models-lib';

export function AgentModelsTab(props: {
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  selected: GatewayAgentRow;
  busy: boolean;
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
    modelRows,
    setModelRows,
    onSaveModels,
    onClearModelsEntry,
  } = props;

  const baselineRows = typedModelsRowsFromList(selected.typedModels.effective);
  const dirty = JSON.stringify(cleanTypedModelsForPatch(modelRows)?.roles ?? {}) !==
    JSON.stringify(cleanTypedModelsForPatch(baselineRows)?.roles ?? {});
  const autosave = useAutosave({ value: modelRows, dirty, onSave: onSaveModels });

  return (
    <SettingsFormSection className="flex min-h-0 flex-1 flex-col">
      <SettingsFormSectionHeader
        className="shrink-0"
        icon={Layers}
        title={a.modelsTabTitle}
        subtitle={a.modelsTabHint}
        trailing={<AutosaveStatus status={autosave.status} error={autosave.error} />}
      />
      <div className="mb-4 grid gap-2 rounded-lg bg-surface-panel/60 p-3 text-xs text-fg-muted shadow-surface">
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
            primaryModel: a.typedModelPrimaryModelLabel,
            fallbackModels: a.typedModelFallbackModelsLabel,
            addFallback: a.typedModelAddFallback,
            removeFallback: a.typedModelRemoveFallback,
            fallbackPlaceholder: a.typedModelFallbackPlaceholder,
            fallbackEmptyHint: a.typedModelFallbackEmptyHint,
            add: a.addTypedModel,
            remove: a.removeTypedModel,
            recommendedTitle: a.typedModelRecommendedTitle,
            customTitle: a.typedModelCustomTitle,
            defaultBadge: a.typedModelDefaultBadge,
            visionBadge: a.typedModelVisionBadge,
            visionAutoHint: a.typedModelVisionAutoHint,
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
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void onClearModelsEntry()}>
          {a.modelsResetInherit}
        </Button>
        <Button asChild variant="ghost">
          <Link to={capabilitySettingsPath('models')}>
            <Settings2 className="size-4" aria-hidden />
            {a.modelsDefaultsLink}
          </Link>
        </Button>
      </div>
    </SettingsFormSection>
  );
}
