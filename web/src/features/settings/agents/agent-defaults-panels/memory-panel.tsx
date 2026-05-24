import { Brain, Search, Sparkles } from 'lucide-react';

import { ModelSelector } from '@/features/chat/model-selector';
import type { AgentDefaultsState } from '@/features/settings/config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsAdvancedDetails } from '../agent-defaults-advanced-details';
import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName, selectClassName } from '../defaults-field-styles';

export function AgentDefaultsMemoryPanel(props: AgentDefaultsPanelProps) {
  const { a, chat, form, update } = props;
  const x = a.advanced;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Brain} title={x.cardMemoryTitle} subtitle={x.cardMemorySubtitle} />
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <AgentDefaultsField label={x.memoryEnabled} description={x.memoryEnabledDesc}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.memory.enabled}
                  onChange={(e) => update({ memory: { ...form.memory, enabled: e.target.checked } })}
                />
                <span>{x.memoryEnabledOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={x.useEnhancedSystem} description={x.useEnhancedSystemDesc}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.memory.useEnhancedSystem}
                  onChange={(e) =>
                    update({ memory: { ...form.memory, useEnhancedSystem: e.target.checked } })
                  }
                />
                <span>{x.useEnhancedSystemOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={x.userProfileEnabled} description={x.userProfileEnabledDesc}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.memory.userProfileEnabled}
                  onChange={(e) =>
                    update({ memory: { ...form.memory, userProfileEnabled: e.target.checked } })
                  }
                />
                <span>{x.userProfileEnabledOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={x.memoryProvider} description={x.memoryProviderDesc}>
              <select
                className={selectClassName()}
                value={form.memory.provider}
                onChange={(e) =>
                  update({
                    memory: {
                      ...form.memory,
                      provider: e.target.value as AgentDefaultsState['memory']['provider'],
                    },
                  })
                }
              >
                <option value="">{x.memoryProviderUnset}</option>
                <option value="none">none</option>
                <option value="stub">stub</option>
              </select>
            </AgentDefaultsField>
          </div>
          <AgentDefaultsAdvancedDetails showLabel={x.advancedOptionsShow} hideLabel={x.advancedOptionsHide}>
            <div className="grid gap-5 sm:grid-cols-2">
              <AgentDefaultsField label={x.injectionFrequency} description={x.injectionFrequencyDesc}>
                <select
                  className={selectClassName()}
                  value={form.memory.injectionFrequency}
                  onChange={(e) =>
                    update({
                      memory: {
                        ...form.memory,
                        injectionFrequency: e.target.value as AgentDefaultsState['memory']['injectionFrequency'],
                      },
                    })
                  }
                >
                  <option value="">{x.injectionFrequencyUnset}</option>
                  <option value="every-turn">{x.injectionEveryTurn}</option>
                  <option value="first-turn">{x.injectionFirstTurn}</option>
                </select>
              </AgentDefaultsField>
              <AgentDefaultsField label={x.memoryCharLimit} description={x.memoryCharLimitDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={1}
                  value={form.memory.memoryCharLimit ?? ''}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value;
                    update({
                      memory: {
                        ...form.memory,
                        memoryCharLimit: v === '' ? undefined : Number.parseInt(v, 10),
                      },
                    });
                  }}
                />
              </AgentDefaultsField>
              <AgentDefaultsField label={x.userCharLimit} description={x.userCharLimitDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={1}
                  value={form.memory.userCharLimit ?? ''}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value;
                    update({
                      memory: {
                        ...form.memory,
                        userCharLimit: v === '' ? undefined : Number.parseInt(v, 10),
                      },
                    });
                  }}
                />
              </AgentDefaultsField>
              <AgentDefaultsField label={x.contextCadence} description={x.contextCadenceDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={1}
                  value={form.memory.contextCadence ?? ''}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value;
                    update({
                      memory: {
                        ...form.memory,
                        contextCadence: v === '' ? undefined : Number.parseInt(v, 10),
                      },
                    });
                  }}
                />
              </AgentDefaultsField>
              <AgentDefaultsField label={x.dialecticCadence} description={x.dialecticCadenceDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={1}
                  value={form.memory.dialecticCadence ?? ''}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value;
                    update({
                      memory: {
                        ...form.memory,
                        dialecticCadence: v === '' ? undefined : Number.parseInt(v, 10),
                      },
                    });
                  }}
                />
              </AgentDefaultsField>
            </div>
          </AgentDefaultsAdvancedDetails>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Search} title={x.cardSessionSearchTitle} subtitle={x.cardSessionSearchSubtitle} />
        <AgentDefaultsField label={x.sessionSearchSummaryModel} description={x.sessionSearchSummaryModelDesc}>
          <ModelSelector
            value={form.sessionSearch.summaryModel}
            placeholder={chat.modelPlaceholder}
            searchPlaceholder={chat.modelSearchPlaceholder}
            noMatches={chat.modelNoMatches}
            onChange={(modelId) =>
              update({ sessionSearch: { ...form.sessionSearch, summaryModel: modelId } })
            }
          />
        </AgentDefaultsField>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Sparkles} title={x.cardReviewTitle} subtitle={x.cardReviewSubtitle} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={x.reviewEnabled} description={x.reviewEnabledDesc}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.backgroundReview.enabled}
                onChange={(e) =>
                  update({ backgroundReview: { ...form.backgroundReview, enabled: e.target.checked } })
                }
              />
              <span>{x.reviewEnabledOn}</span>
            </label>
          </AgentDefaultsField>
          <AgentDefaultsAdvancedDetails showLabel={x.advancedOptionsShow} hideLabel={x.advancedOptionsHide}>
            <div className="grid gap-5 sm:grid-cols-2">
              <AgentDefaultsField label={x.memoryNudgeInterval} description={x.memoryNudgeIntervalDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={0}
                  value={form.backgroundReview.memoryNudgeInterval}
                  onChange={(e) =>
                    update({
                      backgroundReview: {
                        ...form.backgroundReview,
                        memoryNudgeInterval: Number.parseInt(e.target.value, 10) || 0,
                      },
                    })
                  }
                />
              </AgentDefaultsField>
              <AgentDefaultsField label={x.skillNudgeInterval} description={x.skillNudgeIntervalDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={0}
                  value={form.backgroundReview.skillNudgeInterval}
                  onChange={(e) =>
                    update({
                      backgroundReview: {
                        ...form.backgroundReview,
                        skillNudgeInterval: Number.parseInt(e.target.value, 10) || 0,
                      },
                    })
                  }
                />
              </AgentDefaultsField>
              <AgentDefaultsField label={x.reviewMaxToolRounds} description={x.reviewMaxToolRoundsDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={1}
                  max={32}
                  value={form.backgroundReview.maxToolRounds}
                  onChange={(e) =>
                    update({
                      backgroundReview: {
                        ...form.backgroundReview,
                        maxToolRounds: Number.parseInt(e.target.value, 10) || 8,
                      },
                    })
                  }
                />
              </AgentDefaultsField>
              <AgentDefaultsField label={x.reviewMaxHistoryMessages} description={x.reviewMaxHistoryMessagesDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={10}
                  max={200}
                  value={form.backgroundReview.maxHistoryMessages}
                  onChange={(e) =>
                    update({
                      backgroundReview: {
                        ...form.backgroundReview,
                        maxHistoryMessages: Number.parseInt(e.target.value, 10) || 80,
                      },
                    })
                  }
                />
              </AgentDefaultsField>
              <AgentDefaultsField label={x.reviewMaxDurationMs} description={x.reviewMaxDurationMsDesc}>
                <input
                  type="number"
                  className={inputClassName()}
                  min={30}
                  max={600}
                  step={1}
                  value={Math.round((form.backgroundReview.maxDurationMs ?? 120_000) / 1000)}
                  onChange={(e) =>
                    update({
                      backgroundReview: {
                        ...form.backgroundReview,
                        maxDurationMs: (Number.parseInt(e.target.value, 10) || 120) * 1000,
                      },
                    })
                  }
                />
              </AgentDefaultsField>
            </div>
          </AgentDefaultsAdvancedDetails>
        </div>
      </SettingsFormSection>
    </div>
  );
}
