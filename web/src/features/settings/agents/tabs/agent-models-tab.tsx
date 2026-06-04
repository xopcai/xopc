import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { pathForTab } from '@/navigation';

import { TypedModelsEditor } from '../typed-models-editor';
import { formatTypedModelsSummary, typedModelsRowsFromEntry } from '../typed-models-lib';

export function AgentModelsTab(props: {
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  modelsInherit: boolean;
  setModelsInherit: (v: boolean) => void;
  modelsRows: import('../typed-models-lib').AgentTypedModelRow[];
  setModelsRows: (rows: import('../typed-models-lib').AgentTypedModelRow[]) => void;
  onSaveModels: () => void;
  onResetModelsInherit: () => void;
  hideInlineSave?: boolean;
}) {
  const {
    a,
    chat,
    selected,
    busy,
    modelsInherit,
    setModelsInherit,
    modelsRows,
    setModelsRows,
    onSaveModels,
    onResetModelsInherit,
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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setModelsInherit(true);
              setModelsRows(typedModelsRowsFromEntry(selected.typedModels.effective));
            }}
          >
            {a.modelsInherit}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setModelsInherit(false);
              setModelsRows(
                typedModelsRowsFromEntry(selected.typedModels.entry ?? selected.typedModels.effective),
              );
            }}
          >
            {a.modelsCustomize}
          </Button>
          {!modelsInherit ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void onResetModelsInherit()}>
              {a.modelsResetInherit}
            </Button>
          ) : null}
        </div>
        <Link
          to={pathForTab('settingsAgentChat')}
          className="shrink-0 text-xs font-medium text-accent-fg hover:underline"
        >
          {a.modelsDefaultsLink}
        </Link>
      </div>
      <p className="mt-2 shrink-0 text-xs text-fg-muted">
        {a.modelsDefaultsLabel} {formatTypedModelsSummary(selected.typedModels.defaults)}
      </p>
      <p className="shrink-0 text-xs text-fg-muted">
        {a.modelsEffectiveLabel} {formatTypedModelsSummary(selected.typedModels.effective)}
      </p>
      <div className={cn('mt-4 min-h-0 flex-1', modelsInherit && 'opacity-50')}>
        <TypedModelsEditor
          rows={modelsRows}
          disabled={modelsInherit || busy}
          chat={chat}
          onChange={setModelsRows}
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
      {!hideInlineSave ? (
        <div className="mt-4 shrink-0">
          <Button type="button" disabled={busy} onClick={() => void onSaveModels()}>
            {a.modelsSave}
          </Button>
        </div>
      ) : null}
    </SettingsFormSection>
  );
}
