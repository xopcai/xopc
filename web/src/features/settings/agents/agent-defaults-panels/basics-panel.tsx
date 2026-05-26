import { Cpu, SlidersHorizontal, Zap } from 'lucide-react';

import { ModelSelector } from '@/features/chat/model/model-selector';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName, selectClassName } from '../defaults-field-styles';
import { AgentDefaultsChatModelFallbacksSection } from './chat-model-fallbacks-section';

const THINKING_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'] as const;

export function AgentDefaultsBasicsPanel(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Cpu} title={a.cardModelsTitle} subtitle={a.label.model} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={a.label.model} description={a.desc.model}>
            <ModelSelector
              value={form.model}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={chat.modelNoMatches}
              onChange={(modelId) => update({ model: modelId })}
            />
          </AgentDefaultsField>
        </div>
      </SettingsFormSection>

      <AgentDefaultsChatModelFallbacksSection {...props} />

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={SlidersHorizontal} title={a.cardGenerationTitle} subtitle={a.cardGenerationSubtitle} />
        <div className="grid gap-5 sm:grid-cols-2">
          <AgentDefaultsField label={a.label.maxTokens} description={a.desc.maxTokens}>
            <input
              type="number"
              className={inputClassName()}
              value={form.maxTokens}
              min={1}
              onChange={(e) => update({ maxTokens: Number.parseInt(e.target.value, 10) || 0 })}
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
              onChange={(e) => update({ temperature: Number.parseFloat(e.target.value) || 0 })}
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
              onChange={(e) => update({ thinkingDefault: e.target.value })}
            >
              {THINKING_KEYS.map((k) => (
                <option key={k} value={k}>
                  {chat.thinkingLevels[k]}
                </option>
              ))}
            </select>
          </AgentDefaultsField>
          <AgentDefaultsField label={a.label.reasoningDefault} description={a.desc.reasoningDefault}>
            <select
              className={selectClassName()}
              value={form.reasoningDefault}
              onChange={(e) => update({ reasoningDefault: e.target.value })}
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
              onChange={(e) => update({ verboseDefault: e.target.value })}
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
