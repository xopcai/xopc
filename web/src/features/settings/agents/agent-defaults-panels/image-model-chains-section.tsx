import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { ImageGenerationModelInput } from '../image-generation-model-input';

/** Top-level primary model selectors — vision + image generation. */
export function ImageModelPrimarySelectors(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={ImageIcon} title={a.cardModelsTitle} subtitle={a.cardModelsSubtitle} />
      <div className="mt-4 flex flex-col gap-5">
        <AgentDefaultsField label={a.label.imageModel} description={a.desc.imageModel}>
          <ModelSelector
            value={form.imageModel}
            placeholder={chat.modelPlaceholder}
            searchPlaceholder={chat.modelSearchPlaceholder}
            noMatches={chat.modelNoMatches}
            capabilitiesFilter="vision"
            registryEmptyHint={a.visionRegistryEmpty}
            outOfFilterNote={a.visionOutOfFilterNote}
            onChange={(modelId) => update({ imageModel: modelId })}
          />
        </AgentDefaultsField>
        <AgentDefaultsField label={a.label.imageGenerationModel} description={a.desc.imageGenerationModel}>
          <ImageGenerationModelInput
            value={form.imageGenerationModel}
            placeholder={chat.modelPlaceholder}
            searchPlaceholder={chat.modelSearchPlaceholder}
            noMatches={chat.modelNoMatches}
            registryEmptyHint={a.imageGenRegistryEmpty}
            outOfFilterNote={a.imageGenOutOfFilterNote}
            onChange={(modelId) => update({ imageGenerationModel: modelId })}
          />
        </AgentDefaultsField>
      </div>
    </SettingsFormSection>
  );
}

/** Fallback chain lists for vision + image generation — lives inside a collapsible section. */
export function ImageModelFallbackChains(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;

  return (
    <div className="flex flex-col gap-5">
      <AgentDefaultsField label={a.label.imageModelFallbacks} description={a.desc.imageModelFallbacks}>
        <div className="flex flex-col gap-2">
          {form.imageModelFallbacks.map((fb, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ModelSelector
                  value={fb}
                  placeholder={chat.modelPlaceholder}
                  searchPlaceholder={chat.modelSearchPlaceholder}
                  noMatches={chat.modelNoMatches}
                  capabilitiesFilter="vision"
                  registryEmptyHint={a.visionRegistryEmpty}
                  outOfFilterNote={a.visionOutOfFilterNote}
                  onChange={(modelId) => {
                    const next = [...form.imageModelFallbacks];
                    next[idx] = modelId;
                    update({ imageModelFallbacks: next });
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
                    imageModelFallbacks: form.imageModelFallbacks.filter((_, j) => j !== idx),
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
            onClick={() => update({ imageModelFallbacks: [...form.imageModelFallbacks, ''] })}
          >
            <Plus className="size-4 shrink-0" strokeWidth={1.75} />
            {a.addModelFallback}
          </Button>
        </div>
      </AgentDefaultsField>
      <AgentDefaultsField
        label={a.label.imageGenerationModelFallbacks}
        description={a.desc.imageGenerationModelFallbacks}
      >
        <div className="flex flex-col gap-2">
          {form.imageGenerationModelFallbacks.map((fb, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ImageGenerationModelInput
                  value={fb}
                  placeholder={chat.modelPlaceholder}
                  searchPlaceholder={chat.modelSearchPlaceholder}
                  noMatches={chat.modelNoMatches}
                  registryEmptyHint={a.imageGenRegistryEmpty}
                  outOfFilterNote={a.imageGenOutOfFilterNote}
                  onChange={(modelId) => {
                    const next = [...form.imageGenerationModelFallbacks];
                    next[idx] = modelId;
                    update({ imageGenerationModelFallbacks: next });
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
                    imageGenerationModelFallbacks: form.imageGenerationModelFallbacks.filter(
                      (_, j) => j !== idx,
                    ),
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
            onClick={() =>
              update({ imageGenerationModelFallbacks: [...form.imageGenerationModelFallbacks, ''] })
            }
          >
            <Plus className="size-4 shrink-0" strokeWidth={1.75} />
            {a.addModelFallback}
          </Button>
        </div>
      </AgentDefaultsField>
    </div>
  );
}

/**
 * Combined section (legacy export) — renders primary selectors + fallbacks together.
 * @deprecated Prefer `ImageModelPrimarySelectors` + `ImageModelFallbackChains` separately.
 */
export function AgentDefaultsImageModelChainsSection(props: AgentDefaultsPanelProps) {
  return (
    <>
      <ImageModelPrimarySelectors {...props} />
      <ImageModelFallbackChains {...props} />
    </>
  );
}
