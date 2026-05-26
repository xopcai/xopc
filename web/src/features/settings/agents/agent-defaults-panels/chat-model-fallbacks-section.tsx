import { Cpu, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';

/**
 * Chat-only fallback chain (`agents.defaults.modelFallbacks`).
 * Rendered on the Agent defaults / Chat tab right under the primary model
 * selector — when the primary model fails after instant retries, xopc
 * walks this list in order.
 */
export function AgentDefaultsChatModelFallbacksSection(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Cpu} title={a.label.modelFallbacks} subtitle={a.desc.modelFallbacks} />
      <div className="mt-4 flex flex-col gap-2">
        {form.modelFallbacks.map((fb, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ModelSelector
                value={fb}
                placeholder={chat.modelPlaceholder}
                searchPlaceholder={chat.modelSearchPlaceholder}
                noMatches={chat.modelNoMatches}
                onChange={(modelId) => {
                  const next = [...form.modelFallbacks];
                  next[idx] = modelId;
                  update({ modelFallbacks: next });
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              aria-label={a.removeModelFallback}
              onClick={() =>
                update({
                  modelFallbacks: form.modelFallbacks.filter((_, j) => j !== idx),
                })
              }
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="w-fit gap-1.5"
          onClick={() => update({ modelFallbacks: [...form.modelFallbacks, ''] })}
        >
          <Plus className="size-4 shrink-0" strokeWidth={1.75} />
          {a.addModelFallback}
        </Button>
      </div>
    </SettingsFormSection>
  );
}
