import { Minimize2, Plus, X } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CONFIGURED_MODELS_SWR_KEY,
  fetchConfiguredModelsCached,
} from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  DEFAULT_CONTEXT_COMPACTION_CONFIG,
  normalizeContextCompactionFromConfig,
  patchContextCompactionConfig,
  type ContextCompactionConfigState,
  validateContextCompactionConfig,
} from '@/features/settings/context-compaction-config-api';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { SettingsAdvancedGate } from '@/features/settings/settings-advanced-gate';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';
import { createFormDraftReducer, syncFormDraftFromParsed } from '@/lib/settings-form-draft';
import { useLocaleStore } from '@/stores/locale-store';

type PresetId = 'balanced' | 'preserve' | 'early' | 'custom';

const PREVIEW_CONTEXT_WINDOW = 128_000;

const PRESET_VALUES: Record<Exclude<PresetId, 'custom'>, ContextCompactionConfigState> = {
  balanced: DEFAULT_CONTEXT_COMPACTION_CONFIG,
  preserve: {
    ...DEFAULT_CONTEXT_COMPACTION_CONFIG,
    triggerThreshold: 0.88,
    keepRecentTokens: 32_000,
    recentTurnsPreserve: 5,
    maxActiveTranscriptBytes: 4_000_000,
  },
  early: {
    ...DEFAULT_CONTEXT_COMPACTION_CONFIG,
    triggerThreshold: 0.65,
    reserveTokens: 12_000,
    minMessagesBeforeCompact: 6,
    keepRecentTokens: 12_000,
    recentTurnsPreserve: 2,
  },
};

const formReducer = createFormDraftReducer<ContextCompactionConfigState>();

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg disabled:cursor-not-allowed disabled:opacity-55',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function presetComparable(state: ContextCompactionConfigState): string {
  const {
    enabled: _enabled,
    model: _model,
    postCompactionSections: _sections,
    ...rest
  } = state;
  return JSON.stringify(rest);
}

function detectPreset(state: ContextCompactionConfigState): PresetId {
  const comparable = presetComparable(state);
  for (const [id, preset] of Object.entries(PRESET_VALUES)) {
    if (comparable === presetComparable(preset)) return id as Exclude<PresetId, 'custom'>;
  }
  return 'custom';
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return String(value);
}

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-fg" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={inputClassName()}
        value={value}
        onChange={(event) => {
          if (!event.target.value.trim()) return;
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

function CheckSetting({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn('flex items-start gap-2 text-sm text-fg', disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer')}>
      <input
        type="checkbox"
        className="ui-checkbox mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-fg-subtle">{hint}</span>
      </span>
    </label>
  );
}

export function ContextCompactionConfigSection({ hasToken }: { hasToken: boolean }) {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).sessions.compaction;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const { data: configuredModels = [], isLoading: modelsLoading } = useSWR(
    hasToken ? CONFIGURED_MODELS_SWR_KEY : null,
    fetchConfiguredModelsCached,
    { revalidateOnFocus: false },
  );
  const parsed = useMemo(
    () => data?.payload?.config !== undefined
      ? normalizeContextCompactionFromConfig(data.payload.config)
      : null,
    [data],
  );
  const [draft, dispatch] = useReducer(formReducer, { form: null, baseline: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionDraft, setSectionDraft] = useState('');
  const dirtyRef = useRef(false);
  const trackedParsedRef = useRef<ContextCompactionConfigState | null>(null);

  syncFormDraftFromParsed({
    enabled: hasToken,
    parsed,
    dirty: dirtyRef.current,
    trackedParsedRef,
    dispatch,
    onResetDirty: () => {
      dirtyRef.current = false;
    },
  });

  const form = draft.form;
  const baseline = draft.baseline;
  const dirty = Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline));
  const update = useCallback((patch: Partial<ContextCompactionConfigState>) => {
    dirtyRef.current = true;
    setError(null);
    dispatch({ type: 'patch', patch });
  }, []);

  const discard = useCallback(() => {
    dirtyRef.current = false;
    setError(null);
    setSectionDraft('');
    dispatch({ type: 'discard' });
  }, []);

  const fieldLabel = useCallback((field: keyof ContextCompactionConfigState): string => {
    const labels: Record<keyof ContextCompactionConfigState, string> = {
      enabled: t.enabled,
      triggerThreshold: t.triggerThreshold,
      reserveTokens: t.reserveTokens,
      minMessagesBeforeCompact: t.minMessagesBeforeCompact,
      keepRecentTokens: t.keepRecentTokens,
      recentTurnsPreserve: t.recentTurnsPreserve,
      summaryMaxTokens: t.summaryMaxTokens,
      summaryChunkTokens: t.summaryChunkTokens,
      summaryTimeoutMs: t.summaryTimeoutSeconds,
      summaryRetries: t.summaryRetries,
      qualityGuard: t.qualityGuard,
      model: t.summaryModel,
      minToolResultKeepChars: t.minToolResultKeepChars,
      maxActiveTranscriptBytes: t.maxActiveTranscriptMb,
      postCompactionSections: t.postCompactionSections,
    };
    return labels[field];
  }, [t]);

  const save = useCallback(async () => {
    if (!form) return;
    const invalidField = validateContextCompactionConfig(form);
    if (invalidField) {
      const message = t.invalidValue.replace('{{field}}', fieldLabel(invalidField));
      setError(message);
      throw new Error(message);
    }
    setSaving(true);
    setError(null);
    try {
      await patchContextCompactionConfig(form);
      dirtyRef.current = false;
      dispatch({ type: 'saved', value: form });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t.saveError;
      setError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  }, [fieldLabel, form, t.invalidValue, t.saveError]);

  useSaveBarRegistration({
    id: 'context-compaction',
    dirty,
    saving,
    save,
    discard,
  });

  if (!hasToken || !form) {
    return isLoading ? (
      <SettingsFormSection>
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      </SettingsFormSection>
    ) : null;
  }

  const activePreset = detectPreset(form);
  const hardLimitTokens = Math.max(0, PREVIEW_CONTEXT_WINDOW - form.reserveTokens);
  const thresholdTokens = Math.min(
    Math.floor(PREVIEW_CONTEXT_WINDOW * form.triggerThreshold),
    hardLimitTokens,
  );
  const thresholdWidth = Math.min(100, (thresholdTokens / PREVIEW_CONTEXT_WINDOW) * 100);
  const hardLimitWidth = Math.min(100, (hardLimitTokens / PREVIEW_CONTEXT_WINDOW) * 100);
  const selectedSummaryModel = form.model
    ? configuredModels.find((model) => model.id === form.model)
    : undefined;
  const summaryBudgetWarning = selectedSummaryModel?.contextWindow
    && form.summaryChunkTokens + form.summaryMaxTokens + 4_096 > selectedSummaryModel.contextWindow;
  const retentionWarning = form.keepRecentTokens + form.reserveTokens > thresholdTokens;
  const maxAttemptSeconds = Math.round((form.summaryTimeoutMs * (form.summaryRetries + 1)) / 1_000);

  const applyPreset = (presetId: Exclude<PresetId, 'custom'>) => {
    const preset = PRESET_VALUES[presetId];
    update({
      ...preset,
      ...(form.model ? { model: form.model } : { model: undefined }),
      postCompactionSections: form.postCompactionSections,
    });
  };

  const presetCopy = {
    balanced: { title: t.presetBalanced, hint: t.presetBalancedHint },
    preserve: { title: t.presetPreserve, hint: t.presetPreserveHint },
    early: { title: t.presetEarly, hint: t.presetEarlyHint },
  } as const;

  const addSection = () => {
    const next = sectionDraft.trim();
    if (!next
      || form.postCompactionSections.includes(next)
      || form.postCompactionSections.length >= 12) return;
    update({ postCompactionSections: [...form.postCompactionSections, next] });
    setSectionDraft('');
  };

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader
        icon={Minimize2}
        title={t.title}
        subtitle={t.hint}
        trailing={(
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={form.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
            {form.enabled ? t.enabled : t.disabled}
          </label>
        )}
      />

      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {!form.enabled ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {t.disabledWarning}
        </p>
      ) : null}

      <fieldset disabled={!form.enabled} className="space-y-5 disabled:opacity-60">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-fg">{t.presetTitle}</div>
              <p className="mt-0.5 text-xs text-fg-subtle">{t.presetHint}</p>
            </div>
            {activePreset === 'custom' ? (
              <span className="rounded-full bg-surface-hover px-2 py-1 text-[11px] font-medium text-fg-muted">
                {t.presetCustom}
              </span>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['balanced', 'preserve', 'early'] as const).map((presetId) => (
              <button
                key={presetId}
                type="button"
                aria-pressed={activePreset === presetId}
                className={cn(
                  'rounded-xl border px-3 py-3 text-left',
                  interaction.transition,
                  interaction.focusRingPanel,
                  activePreset === presetId
                    ? 'border-accent/50 bg-accent-soft text-accent-fg'
                    : 'border-edge bg-surface-panel text-fg hover:bg-surface-hover',
                )}
                onClick={() => applyPreset(presetId)}
              >
                <span className="block text-sm font-medium">{presetCopy[presetId].title}</span>
                <span className="mt-1 block text-xs text-fg-muted">
                  {presetCopy[presetId].hint}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-edge-subtle bg-surface-hover/35 p-4 dark:border-edge">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-fg">{t.budgetPreview}</div>
              <p className="mt-0.5 text-xs text-fg-subtle">{t.budgetPreviewHint}</p>
            </div>
            <span className="rounded-full bg-surface-panel px-2.5 py-1 font-mono text-xs text-fg-muted">
              {t.previewModel128k}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 flex justify-between gap-3 text-xs text-fg-muted">
                <span>{t.compactionTrigger}</span>
                <span className="font-mono text-fg">{formatTokens(thresholdTokens)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-active">
                <div className="h-full rounded-full bg-accent" style={{ width: `${thresholdWidth}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between gap-3 text-xs text-fg-muted">
                <span>{t.hardInputLimit}</span>
                <span className="font-mono text-fg">{formatTokens(hardLimitTokens)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-active">
                <div className="h-full rounded-full bg-fg-subtle" style={{ width: `${hardLimitWidth}%` }} />
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-fg-subtle">{t.budgetFormula}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="compaction-trigger-threshold"
            label={t.triggerThreshold}
            hint={t.triggerThresholdHint}
            value={Number((form.triggerThreshold * 100).toFixed(2))}
            min={10}
            max={98}
            step={0.1}
            onChange={(value) => update({ triggerThreshold: value / 100 })}
          />
          <NumberField
            id="compaction-reserve-tokens"
            label={t.reserveTokens}
            hint={t.reserveTokensHint.replace('{{tokens}}', formatTokens(form.reserveTokens))}
            value={form.reserveTokens}
            min={1_024}
            step={1_024}
            onChange={(reserveTokens) => update({ reserveTokens: Math.floor(reserveTokens) })}
          />
          <NumberField
            id="compaction-recent-turns"
            label={t.recentTurnsPreserve}
            hint={t.recentTurnsPreserveHint}
            value={form.recentTurnsPreserve}
            min={1}
            max={12}
            onChange={(recentTurnsPreserve) => update({ recentTurnsPreserve: Math.floor(recentTurnsPreserve) })}
          />
          <NumberField
            id="compaction-keep-recent-tokens"
            label={t.keepRecentTokens}
            hint={t.keepRecentTokensHint.replace('{{tokens}}', formatTokens(form.keepRecentTokens))}
            value={form.keepRecentTokens}
            min={1_000}
            step={1_000}
            onChange={(keepRecentTokens) => update({ keepRecentTokens: Math.floor(keepRecentTokens) })}
          />
        </div>

        {retentionWarning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {t.retentionWarning}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">{t.summaryModel}</label>
            <div className="flex min-w-0 gap-2">
              <ModelSelector
                value={form.model ?? ''}
                disabled={!form.enabled}
                placeholder={t.summaryModelInherited}
                searchPlaceholder={t.summaryModelSearch}
                noMatches={t.summaryModelNoMatches}
                models={configuredModels}
                modelsLoading={modelsLoading}
                className="min-w-0 flex-1 justify-between"
                contentAlign="start"
                showProviderSettingsFooter
                onChange={(model) => update({ model })}
              />
              {form.model ? (
                <Button type="button" variant="secondary" onClick={() => update({ model: undefined })}>
                  {t.summaryModelUseSession}
                </Button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-fg-subtle">{t.summaryModelHint}</p>
          </div>
          <CheckSetting
            label={t.qualityGuard}
            hint={t.qualityGuardHint}
            checked={form.qualityGuard}
            onChange={(qualityGuard) => update({ qualityGuard })}
          />
        </div>

        {!form.qualityGuard ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {t.qualityGuardWarning}
          </p>
        ) : null}

        <SettingsAdvancedGate>
          <div className="space-y-5 border-t border-edge pt-5">
            <div>
              <div className="text-sm font-semibold text-fg">{t.advancedTitle}</div>
              <p className="mt-0.5 text-xs text-fg-subtle">{t.advancedHint}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="compaction-min-messages"
                label={t.minMessagesBeforeCompact}
                hint={t.minMessagesBeforeCompactHint}
                value={form.minMessagesBeforeCompact}
                min={2}
                onChange={(minMessagesBeforeCompact) => update({ minMessagesBeforeCompact: Math.floor(minMessagesBeforeCompact) })}
              />
              <NumberField
                id="compaction-max-transcript-mb"
                label={t.maxActiveTranscriptMb}
                hint={t.maxActiveTranscriptMbHint}
                value={Number((form.maxActiveTranscriptBytes / 1_000_000).toFixed(3))}
                min={0.064}
                step={0.1}
                onChange={(value) => update({ maxActiveTranscriptBytes: Math.max(64_000, Math.round(value * 1_000_000)) })}
              />
              <NumberField
                id="compaction-summary-max-tokens"
                label={t.summaryMaxTokens}
                hint={t.summaryMaxTokensHint}
                value={form.summaryMaxTokens}
                min={256}
                step={256}
                onChange={(summaryMaxTokens) => update({ summaryMaxTokens: Math.floor(summaryMaxTokens) })}
              />
              <NumberField
                id="compaction-summary-chunk-tokens"
                label={t.summaryChunkTokens}
                hint={t.summaryChunkTokensHint}
                value={form.summaryChunkTokens}
                min={1_000}
                step={1_000}
                onChange={(summaryChunkTokens) => update({ summaryChunkTokens: Math.floor(summaryChunkTokens) })}
              />
              <NumberField
                id="compaction-summary-timeout"
                label={t.summaryTimeoutSeconds}
                hint={t.summaryTimeoutSecondsHint.replace('{{seconds}}', String(maxAttemptSeconds))}
                value={form.summaryTimeoutMs / 1_000}
                min={1}
                max={600}
                onChange={(seconds) => update({ summaryTimeoutMs: Math.round(seconds * 1_000) })}
              />
              <NumberField
                id="compaction-summary-retries"
                label={t.summaryRetries}
                hint={t.summaryRetriesHint}
                value={form.summaryRetries}
                min={0}
                max={5}
                onChange={(summaryRetries) => update({ summaryRetries: Math.floor(summaryRetries) })}
              />
              <NumberField
                id="compaction-min-tool-result-chars"
                label={t.minToolResultKeepChars}
                hint={t.minToolResultKeepCharsHint}
                value={form.minToolResultKeepChars}
                min={200}
                step={100}
                onChange={(minToolResultKeepChars) => update({ minToolResultKeepChars: Math.floor(minToolResultKeepChars) })}
              />
            </div>

            {summaryBudgetWarning ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                {t.summaryBudgetWarning}
              </p>
            ) : null}

            <div className="border-t border-edge pt-5">
              <div className="text-sm font-medium text-fg">{t.postCompactionSections}</div>
              <p className="mt-1 text-xs text-fg-subtle">{t.postCompactionSectionsHint}</p>
              {form.postCompactionSections.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.postCompactionSections.map((section) => (
                    <span
                      key={section}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs text-fg"
                    >
                      {section}
                      <button
                        type="button"
                        className={cn('text-fg-muted hover:text-fg', interaction.press)}
                        aria-label={t.removeSection.replace('{{section}}', section)}
                        onClick={() => update({
                          postCompactionSections: form.postCompactionSections.filter((value) => value !== section),
                        })}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-fg-muted">{t.postCompactionSectionsEmpty}</p>
              )}
              <div className="mt-3 flex gap-2">
                <input
                  className={inputClassName()}
                  value={sectionDraft}
                  maxLength={120}
                  disabled={form.postCompactionSections.length >= 12}
                  placeholder={t.postCompactionSectionsPlaceholder}
                  onChange={(event) => setSectionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addSection();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!sectionDraft.trim() || form.postCompactionSections.length >= 12}
                  onClick={addSection}
                >
                  <Plus className="size-4" aria-hidden />
                  {t.addSection}
                </Button>
              </div>
            </div>
          </div>
        </SettingsAdvancedGate>
      </fieldset>

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
          {t.discard}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!dirty || saving}
          onClick={() => void save().catch(() => {})}
        >
          {saving ? t.saving : t.save}
        </Button>
      </div>
    </SettingsFormSection>
  );
}
