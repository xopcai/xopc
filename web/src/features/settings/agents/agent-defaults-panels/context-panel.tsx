import { Layers2, Scissors } from 'lucide-react';

import type { AgentDefaultsState } from '@/features/settings/config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { SettingsAdvancedGate } from '@/features/settings/settings-advanced-gate';

import { AgentDefaultsAdvancedDetails } from '../agent-defaults-advanced-details';
import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName, selectClassName } from '../defaults-field-styles';

export function AgentDefaultsContextPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;
  const x = a.advanced;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Layers2} title={x.cardCompactionTitle} subtitle={x.cardCompactionSubtitle} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={x.compactionEnabled} description={x.compactionEnabledDesc}>
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
          </AgentDefaultsField>
          <SettingsAdvancedGate>
            <AgentDefaultsField label={x.compactionMode} description={x.compactionModeDesc}>
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
            </AgentDefaultsField>
          </SettingsAdvancedGate>
          <AgentDefaultsAdvancedDetails showLabel={x.advancedOptionsShow} hideLabel={x.advancedOptionsHide}>
            <div className="grid gap-5 sm:grid-cols-2">
              <AgentDefaultsField label={x.reserveTokens} description={x.reserveTokensDesc}>
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
              </AgentDefaultsField>
              <AgentDefaultsField label={x.triggerThreshold} description={x.triggerThresholdDesc}>
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
              </AgentDefaultsField>
              <AgentDefaultsField label={x.minMessagesBeforeCompact} description={x.minMessagesBeforeCompactDesc}>
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
              </AgentDefaultsField>
              <AgentDefaultsField label={x.keepRecentMessages} description={x.keepRecentMessagesDesc}>
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
              </AgentDefaultsField>
              <AgentDefaultsField label={x.evictionWindow} description={x.evictionWindowDesc}>
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
              </AgentDefaultsField>
              <AgentDefaultsField label={x.retentionWindow} description={x.retentionWindowDesc}>
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
              </AgentDefaultsField>
            </div>
          </AgentDefaultsAdvancedDetails>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Scissors} title={x.cardPruningTitle} subtitle={x.cardPruningSubtitle} />
        <div className="flex flex-col gap-5">
          <AgentDefaultsField label={x.pruningEnabled} description={x.pruningEnabledDesc}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.pruning.enabled}
                onChange={(e) => update({ pruning: { ...form.pruning, enabled: e.target.checked } })}
              />
              <span>{x.pruningEnabledOn}</span>
            </label>
          </AgentDefaultsField>
          <AgentDefaultsField label={x.maxToolResultChars} description={x.maxToolResultCharsDesc}>
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
          </AgentDefaultsField>
          <AgentDefaultsAdvancedDetails showLabel={x.advancedOptionsShow} hideLabel={x.advancedOptionsHide}>
            <div className="grid gap-5 sm:grid-cols-2">
              <AgentDefaultsField label={x.headKeepRatio} description={x.headKeepRatioDesc}>
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
              </AgentDefaultsField>
              <AgentDefaultsField label={x.tailKeepRatio} description={x.tailKeepRatioDesc}>
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
              </AgentDefaultsField>
            </div>
          </AgentDefaultsAdvancedDetails>
        </div>
      </SettingsFormSection>
    </div>
  );
}
