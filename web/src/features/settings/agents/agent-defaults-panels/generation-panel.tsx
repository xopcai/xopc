import { SlidersHorizontal, Zap } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName, selectClassName } from '../defaults-field-styles';

const THINKING_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'] as const;

export function AgentDefaultsGenerationPanel(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={SlidersHorizontal} title={a.cardGenerationTitle} subtitle={a.cardGenerationSubtitle} />
        <div className="grid gap-5 sm:grid-cols-2">
          <AgentDefaultsField label={a.label.maxTokens} description={a.desc.maxTokens}>
            <input
              type="number"
              className={inputClassName()}
              value={form.maxTokens}
              min={1}
              onChange={(event) => update({ maxTokens: Number.parseInt(event.target.value, 10) || 0 })}
            />
          </AgentDefaultsField>
          <AgentDefaultsField label={a.label.temperature} description={a.desc.temperature}>
            <input
              type="number"
              className={inputClassName()}
              value={form.temperature}
              min={0}
              max={2}
              step={0.1}
              onChange={(event) => update({ temperature: Number.parseFloat(event.target.value) || 0 })}
            />
          </AgentDefaultsField>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Zap} title={a.cardBehaviorTitle} subtitle={a.cardBehaviorSubtitle} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={a.label.thinkingDefault} description={a.desc.thinkingDefault}>
            <select
              className={selectClassName()}
              value={form.thinkingDefault}
              onChange={(event) => update({ thinkingDefault: event.target.value })}
            >
              {THINKING_KEYS.map((key) => (
                <option key={key} value={key}>
                  {chat.thinkingLevels[key]}
                </option>
              ))}
            </select>
          </AgentDefaultsField>
          <AgentDefaultsField label={a.label.reasoningDefault} description={a.desc.reasoningDefault}>
            <select
              className={selectClassName()}
              value={form.reasoningDefault}
              onChange={(event) => update({ reasoningDefault: event.target.value })}
            >
              <option value="off">{a.reasoning.off}</option>
              <option value="on">{a.reasoning.on}</option>
              <option value="stream">{a.reasoning.stream}</option>
            </select>
          </AgentDefaultsField>
          <AgentDefaultsField label={a.label.verboseDefault} description={a.desc.verboseDefault}>
            <select
              className={selectClassName()}
              value={form.verboseDefault}
              onChange={(event) => update({ verboseDefault: event.target.value })}
            >
              <option value="off">{a.verbose.off}</option>
              <option value="on">{a.verbose.on}</option>
              <option value="full">{a.verbose.full}</option>
            </select>
          </AgentDefaultsField>
        </div>
      </SettingsFormSection>
    </div>
  );
}
