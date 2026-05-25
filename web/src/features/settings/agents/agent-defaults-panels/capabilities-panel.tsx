import { Code2, FileText } from 'lucide-react';

import { ModelSelector } from '@/features/chat/model/model-selector';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName } from '../defaults-field-styles';
import { AgentDefaultsBuiltinToolsDisableSection } from './builtin-tools-disable-section';

export function AgentDefaultsCapabilitiesPanel(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;
  const x = a.advanced;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={FileText}
          title={x.cardWebExtractTitle}
          subtitle={x.cardWebExtractSubtitle}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <AgentDefaultsField label={x.webExtractModel} description={x.webExtractModelDesc}>
              <ModelSelector
                value={form.webExtract.model}
                placeholder={chat.modelPlaceholder}
                searchPlaceholder={chat.modelSearchPlaceholder}
                noMatches={chat.modelNoMatches}
                onChange={(modelId) => update({ webExtract: { ...form.webExtract, model: modelId } })}
              />
            </AgentDefaultsField>
          </div>
          <AgentDefaultsField label={x.webExtractMaxLength} description={x.webExtractMaxLengthDesc}>
            <input
              type="number"
              className={inputClassName()}
              min={1}
              value={form.webExtract.maxLength ?? ''}
              placeholder="—"
              onChange={(e) => {
                const v = e.target.value;
                update({
                  webExtract: {
                    ...form.webExtract,
                    maxLength: v === '' ? undefined : Number.parseInt(v, 10),
                  },
                });
              }}
            />
          </AgentDefaultsField>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Code2} title={x.cardDelegateTitle} subtitle={x.cardDelegateSubtitle} />
        <div className="grid gap-5 sm:grid-cols-2">
          <AgentDefaultsField label={x.delegateEnabled} description={x.delegateEnabledDesc}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.delegate.enabled}
                onChange={(e) => update({ delegate: { ...form.delegate, enabled: e.target.checked } })}
              />
              <span>{x.delegateEnabledOn}</span>
            </label>
          </AgentDefaultsField>
          <AgentDefaultsField label={x.executeCodeEnabled} description={x.executeCodeEnabledDesc}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.executeCode.enabled}
                onChange={(e) =>
                  update({ executeCode: { ...form.executeCode, enabled: e.target.checked } })
                }
              />
              <span>{x.executeCodeEnabledOn}</span>
            </label>
          </AgentDefaultsField>
        </div>
      </SettingsFormSection>

      <AgentDefaultsBuiltinToolsDisableSection {...props} />
    </div>
  );
}
