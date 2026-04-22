import { Brain, Clock, Code2, FileText, Layers2, Library, Scissors, Search, Sparkles, Timer, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model-selector';
import type { AgentDefaultsState } from '@/features/settings/config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { MessageBundle } from '@/i18n/messages';

import { inputClassName, selectClassName } from './defaults-field-styles';

type A = MessageBundle['agentSettings'];

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium text-fg">{label}</div>
      {children}
      <p className="text-xs leading-relaxed text-fg-subtle">{description}</p>
    </div>
  );
}

export function AgentDefaultsExtraFields(props: {
  a: A;
  chat: MessageBundle['chat'];
  form: AgentDefaultsState;
  update: (patch: Partial<AgentDefaultsState>) => void;
}) {
  const { a, chat, form, update } = props;
  const x = a.advanced;

  return (
    <>
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Timer} title={x.cardLimitsTitle} subtitle={x.cardLimitsSubtitle} />
        <div className="flex flex-col gap-5">
          <Field label={x.maxTaskDurationMs} description={x.maxTaskDurationMsDesc}>
            <input
              type="number"
              className={inputClassName()}
              min={1}
              max={240}
              step={1}
              value={form.maxTaskDurationMinutes ?? ''}
              placeholder={x.maxTaskDurationPlaceholder}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  update({ maxTaskDurationMinutes: undefined });
                  return;
                }
                const n = Number.parseInt(v, 10);
                if (Number.isNaN(n)) {
                  return;
                }
                update({ maxTaskDurationMinutes: Math.min(240, Math.max(1, n)) });
              }}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={x.maxRequestsPerTurn} description={x.maxRequestsPerTurnDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={10}
                max={200}
                value={form.maxRequestsPerTurn}
                onChange={(e) => update({ maxRequestsPerTurn: Number.parseInt(e.target.value, 10) || 50 })}
              />
            </Field>
            <Field label={x.maxToolFailuresPerTurn} description={x.maxToolFailuresPerTurnDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={1}
                max={20}
                value={form.maxToolFailuresPerTurn}
                onChange={(e) => update({ maxToolFailuresPerTurn: Number.parseInt(e.target.value, 10) || 3 })}
              />
            </Field>
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Layers2} title={x.cardCompactionTitle} subtitle={x.cardCompactionSubtitle} />
        <div className="flex flex-col gap-5">
          <Field label={x.compactionEnabled} description={x.compactionEnabledDesc}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.compaction.enabled}
                onChange={(e) =>
                  update({ compaction: { ...form.compaction, enabled: e.target.checked } })
                }
              />
              <span>{x.compactionEnabledOn}</span>
            </label>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={x.compactionMode} description={x.compactionModeDesc}>
              <select
                className={selectClassName()}
                value={form.compaction.mode}
                onChange={(e) =>
                  update({
                    compaction: {
                      ...form.compaction,
                      mode: e.target.value as AgentDefaultsState['compaction']['mode'],
                    },
                  })
                }
              >
                <option value="default">{x.compactionModeDefault}</option>
                <option value="safeguard">{x.compactionModeSafeguard}</option>
              </select>
            </Field>
            <Field label={x.reserveTokens} description={x.reserveTokensDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={1000}
                value={form.compaction.reserveTokens}
                onChange={(e) =>
                  update({
                    compaction: {
                      ...form.compaction,
                      reserveTokens: Number.parseInt(e.target.value, 10) || 0,
                    },
                  })
                }
              />
            </Field>
            <Field label={x.triggerThreshold} description={x.triggerThresholdDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={0.5}
                max={0.95}
                step={0.05}
                value={form.compaction.triggerThreshold}
                onChange={(e) =>
                  update({
                    compaction: {
                      ...form.compaction,
                      triggerThreshold: Number.parseFloat(e.target.value) || 0.8,
                    },
                  })
                }
              />
            </Field>
            <Field label={x.minMessagesBeforeCompact} description={x.minMessagesBeforeCompactDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={1}
                value={form.compaction.minMessagesBeforeCompact}
                onChange={(e) =>
                  update({
                    compaction: {
                      ...form.compaction,
                      minMessagesBeforeCompact: Number.parseInt(e.target.value, 10) || 10,
                    },
                  })
                }
              />
            </Field>
            <Field label={x.keepRecentMessages} description={x.keepRecentMessagesDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={0}
                value={form.compaction.keepRecentMessages}
                onChange={(e) =>
                  update({
                    compaction: {
                      ...form.compaction,
                      keepRecentMessages: Number.parseInt(e.target.value, 10) || 5,
                    },
                  })
                }
              />
            </Field>
            <Field label={x.evictionWindow} description={x.evictionWindowDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={0.1}
                max={0.5}
                step={0.05}
                value={form.compaction.evictionWindow}
                onChange={(e) =>
                  update({
                    compaction: {
                      ...form.compaction,
                      evictionWindow: Number.parseFloat(e.target.value) || 0.2,
                    },
                  })
                }
              />
            </Field>
            <Field label={x.retentionWindow} description={x.retentionWindowDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={3}
                max={20}
                value={form.compaction.retentionWindow}
                onChange={(e) =>
                  update({
                    compaction: {
                      ...form.compaction,
                      retentionWindow: Number.parseInt(e.target.value, 10) || 6,
                    },
                  })
                }
              />
            </Field>
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Scissors} title={x.cardPruningTitle} subtitle={x.cardPruningSubtitle} />
        <div className="flex flex-col gap-5">
          <Field label={x.pruningEnabled} description={x.pruningEnabledDesc}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.pruning.enabled}
                onChange={(e) => update({ pruning: { ...form.pruning, enabled: e.target.checked } })}
              />
              <span>{x.pruningEnabledOn}</span>
            </label>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={x.maxToolResultChars} description={x.maxToolResultCharsDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={1000}
                value={form.pruning.maxToolResultChars}
                onChange={(e) =>
                  update({
                    pruning: {
                      ...form.pruning,
                      maxToolResultChars: Number.parseInt(e.target.value, 10) || 10000,
                    },
                  })
                }
              />
            </Field>
            <Field label={x.headKeepRatio} description={x.headKeepRatioDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={0}
                max={1}
                step={0.05}
                value={form.pruning.headKeepRatio}
                onChange={(e) =>
                  update({
                    pruning: { ...form.pruning, headKeepRatio: Number.parseFloat(e.target.value) || 0.3 },
                  })
                }
              />
            </Field>
            <Field label={x.tailKeepRatio} description={x.tailKeepRatioDesc}>
              <input
                type="number"
                className={inputClassName()}
                min={0}
                max={1}
                step={0.05}
                value={form.pruning.tailKeepRatio}
                onChange={(e) =>
                  update({
                    pruning: { ...form.pruning, tailKeepRatio: Number.parseFloat(e.target.value) || 0.3 },
                  })
                }
              />
            </Field>
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Brain} title={x.cardMemoryTitle} subtitle={x.cardMemorySubtitle} />
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={x.memoryEnabled} description={x.memoryEnabledDesc}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.memory.enabled}
                  onChange={(e) => update({ memory: { ...form.memory, enabled: e.target.checked } })}
                />
                <span>{x.memoryEnabledOn}</span>
              </label>
            </Field>
            <Field label={x.useEnhancedSystem} description={x.useEnhancedSystemDesc}>
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
            </Field>
            <Field label={x.userProfileEnabled} description={x.userProfileEnabledDesc}>
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
            </Field>
            <Field label={x.memoryProvider} description={x.memoryProviderDesc}>
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
            </Field>
            <Field label={x.injectionFrequency} description={x.injectionFrequencyDesc}>
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
            </Field>
            <Field label={x.memoryCharLimit} description={x.memoryCharLimitDesc}>
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
            </Field>
            <Field label={x.userCharLimit} description={x.userCharLimitDesc}>
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
            </Field>
            <Field label={x.contextCadence} description={x.contextCadenceDesc}>
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
            </Field>
            <Field label={x.dialecticCadence} description={x.dialecticCadenceDesc}>
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
            </Field>
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Search} title={x.cardSessionSearchTitle} subtitle={x.cardSessionSearchSubtitle} />
        <Field label={x.sessionSearchSummaryModel} description={x.sessionSearchSummaryModelDesc}>
          <ModelSelector
            value={form.sessionSearch.summaryModel}
            placeholder={chat.modelPlaceholder}
            searchPlaceholder={chat.modelSearchPlaceholder}
            noMatches={chat.modelNoMatches}
            onChange={(modelId) =>
              update({ sessionSearch: { ...form.sessionSearch, summaryModel: modelId } })
            }
          />
        </Field>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Sparkles} title={x.cardReviewTitle} subtitle={x.cardReviewSubtitle} />
        <div className="flex flex-col gap-5">
          <Field label={x.reviewEnabled} description={x.reviewEnabledDesc}>
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
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={x.memoryNudgeInterval} description={x.memoryNudgeIntervalDesc}>
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
            </Field>
            <Field label={x.skillNudgeInterval} description={x.skillNudgeIntervalDesc}>
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
            </Field>
            <Field label={x.reviewMaxToolRounds} description={x.reviewMaxToolRoundsDesc}>
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
            </Field>
            <Field label={x.reviewMaxHistoryMessages} description={x.reviewMaxHistoryMessagesDesc}>
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
            </Field>
            <Field label={x.reviewMaxDurationMs} description={x.reviewMaxDurationMsDesc}>
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
            </Field>
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={FileText}
          title={x.cardWebExtractTitle}
          subtitle={x.cardWebExtractSubtitle}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={x.webExtractModel} description={x.webExtractModelDesc}>
              <ModelSelector
                value={form.webExtract.model}
                placeholder={chat.modelPlaceholder}
                searchPlaceholder={chat.modelSearchPlaceholder}
                noMatches={chat.modelNoMatches}
                onChange={(modelId) => update({ webExtract: { ...form.webExtract, model: modelId } })}
              />
            </Field>
          </div>
          <Field label={x.webExtractMaxLength} description={x.webExtractMaxLengthDesc}>
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
          </Field>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Code2} title={x.cardDelegateTitle} subtitle={x.cardDelegateSubtitle} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={x.delegateEnabled} description={x.delegateEnabledDesc}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.delegate.enabled}
                onChange={(e) => update({ delegate: { ...form.delegate, enabled: e.target.checked } })}
              />
              <span>{x.delegateEnabledOn}</span>
            </label>
          </Field>
          <Field label={x.executeCodeEnabled} description={x.executeCodeEnabledDesc}>
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
          </Field>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={Library}
          title={x.cardPromptSkillsTitle}
          subtitle={x.cardPromptSkillsSubtitle}
        />
        <div className="flex flex-col gap-5">
          <Field label={x.systemPromptOverride} description={x.systemPromptOverrideDesc}>
            <textarea
              className={cn(inputClassName(), 'min-h-[100px] resize-y font-mono text-xs')}
              value={form.systemPromptOverride}
              placeholder={x.systemPromptPlaceholder}
              onChange={(e) => update({ systemPromptOverride: e.target.value })}
            />
          </Field>
          <Field label={x.skillsAllowlist} description={x.skillsAllowlistDesc}>
            <div className="flex flex-col gap-2">
              {form.skillsAllowlist.map((s, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    value={s}
                    onChange={(e) => {
                      const next = [...form.skillsAllowlist];
                      next[idx] = e.target.value;
                      update({ skillsAllowlist: next });
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    aria-label={x.removeListItem}
                    onClick={() =>
                      update({ skillsAllowlist: form.skillsAllowlist.filter((_, j) => j !== idx) })
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="w-fit"
                onClick={() => update({ skillsAllowlist: [...form.skillsAllowlist, ''] })}
              >
                {x.addSkillName}
              </Button>
            </div>
          </Field>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Wrench} title={x.cardToolsDisableTitle} subtitle={x.cardToolsDisableSubtitle} />
        <div className="flex flex-col gap-5">
          <p className="text-xs text-fg-muted">{x.toolsDisableHint}</p>
          <div className="flex flex-col gap-2">
            {form.toolsDisable.map((s, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  className={cn(inputClassName(), 'font-mono text-xs')}
                  value={s}
                  placeholder="shell"
                  onChange={(e) => {
                    const next = [...form.toolsDisable];
                    next[idx] = e.target.value;
                    update({ toolsDisable: next });
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  aria-label={x.removeListItem}
                  onClick={() => update({ toolsDisable: form.toolsDisable.filter((_, j) => j !== idx) })}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              onClick={() => update({ toolsDisable: [...form.toolsDisable, ''] })}
            >
              {x.addToolName}
            </Button>
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Clock} title={x.cardParamsTitle} subtitle={x.cardParamsSubtitle} />
        <Field label={x.paramsJson} description={x.paramsJsonDesc}>
          <textarea
            className={cn(inputClassName(), 'min-h-[88px] resize-y font-mono text-xs')}
            value={form.paramsJson}
            placeholder="{}"
            onChange={(e) => update({ paramsJson: e.target.value })}
          />
        </Field>
      </SettingsFormSection>
    </>
  );
}
