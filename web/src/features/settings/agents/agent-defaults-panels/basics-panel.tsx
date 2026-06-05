import { ArrowRight, Cpu } from 'lucide-react';

import { ModelSelector } from '@/features/chat/model/model-selector';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { AgentDefaultsChatModelFallbacksSection } from './chat-model-fallbacks-section';
import { AgentDefaultsTypedModelsSection } from './typed-models-section';

function ModelResolutionChain({
  globalLabel,
  agentLabel,
  sessionLabel,
  globalValue,
  agentValue,
  sessionValue,
}: {
  globalLabel: string;
  agentLabel: string;
  sessionLabel: string;
  globalValue: string;
  agentValue: string;
  sessionValue: string;
}) {
  const items = [
    { label: globalLabel, value: globalValue },
    { label: agentLabel, value: agentValue },
    { label: sessionLabel, value: sessionValue },
  ];

  return (
    <div className="grid gap-2 rounded-2xl border border-edge-subtle bg-surface-panel/60 p-3 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
      {items.map((item, index) => (
        <div key={item.label} className="contents">
          <div className="min-w-0 rounded-xl bg-surface-base px-3 py-2">
            <p className="font-medium text-fg-subtle">{item.label}</p>
            <p className="mt-1 truncate text-sm font-medium text-fg">{item.value}</p>
          </div>
          {index < items.length - 1 ? (
            <div className="hidden items-center justify-center text-fg-disabled sm:flex" aria-hidden>
              <ArrowRight className="size-4" strokeWidth={1.75} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AgentDefaultsBasicsPanel(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Cpu} title={a.cardModelsTitle} subtitle={a.cardModelsSubtitle} />
        <ModelResolutionChain
          globalLabel={a.modelResolutionGlobal}
          agentLabel={a.modelResolutionAgent}
          sessionLabel={a.modelResolutionSession}
          globalValue={form.model || a.modelResolutionUnset}
          agentValue={a.modelResolutionAgentInherits}
          sessionValue={a.modelResolutionSessionSelectable}
        />
        <div className="mt-5 flex flex-col gap-5">
          <AgentDefaultsField label={a.label.model} description={a.desc.model}>
            <ModelSelector
              value={form.model}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={chat.modelNoMatches}
              showProviderSettingsFooter
              onChange={(modelId) => update({ model: modelId })}
            />
          </AgentDefaultsField>
        </div>
      </SettingsFormSection>
      <AgentDefaultsChatModelFallbacksSection {...props} />
      <AgentDefaultsTypedModelsSection {...props} />
    </div>
  );
}
