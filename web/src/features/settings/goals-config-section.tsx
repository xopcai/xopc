import { Target, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeGoalsConfigFromConfig,
  patchGoalsConfig,
  type GoalsConfigState,
} from '@/features/settings/goals-config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

export function GoalsConfigSection({ hasToken }: { hasToken: boolean }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).goalsSettings;
  const chatM = messages(language).chat;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const parsed = useMemo(
    () => (data?.payload?.config !== undefined ? normalizeGoalsConfigFromConfig(data.payload.config) : null),
    [data],
  );
  const [form, setForm] = useState<GoalsConfigState | null>(null);
  const [baseline, setBaseline] = useState<GoalsConfigState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!hasToken || parsed === null || dirtyRef.current) return;
    setForm(structuredClone(parsed));
    setBaseline(structuredClone(parsed));
  }, [hasToken, parsed]);

  const dirty = form && baseline && JSON.stringify(form) !== JSON.stringify(baseline);

  const update = useCallback((patch: Partial<GoalsConfigState>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  if (!hasToken || !form) {
    return isLoading ? (
      <SettingsFormSection>
        <Loader2 className="size-4 animate-spin text-fg-muted" />
      </SettingsFormSection>
    ) : null;
  }

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Target} title={t.title} subtitle={t.hint} />
      <div className="mb-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={() => baseline && setForm(structuredClone(baseline))}>
          {t.discard}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!dirty || saving}
          onClick={() => {
            void (async () => {
              setSaving(true);
              setError(null);
              try {
                await patchGoalsConfig(form);
                dirtyRef.current = false;
                setBaseline(structuredClone(form));
              } catch (e) {
                setError(e instanceof Error ? e.message : t.saveError);
              } finally {
                setSaving(false);
              }
            })();
          }}
        >
          {saving ? t.saving : t.save}
        </Button>
      </div>
      {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.maxTurns}</label>
          <input type="number" min={1} max={500} className={inputClassName()} value={form.maxTurns} onChange={(e) => update({ maxTurns: Number(e.target.value) || 20 })} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.judgeModelRef}</label>
          <ModelSelector
            value={form.judgeModelRef}
            placeholder={t.judgeModelRefPlaceholder}
            searchPlaceholder={chatM.modelSearchPlaceholder}
            noMatches={chatM.modelNoMatches}
            className="w-full max-w-none min-w-0"
            onChange={(modelId) => update({ judgeModelRef: modelId })}
          />
          {form.judgeModelRef.trim() ? (
            <button
              type="button"
              className="mt-1 text-xs text-accent hover:underline"
              onClick={() => update({ judgeModelRef: '' })}
            >
              {t.judgeModelRefUseDefault}
            </button>
          ) : (
            <p className="mt-1 text-xs text-fg-subtle">{t.judgeModelRefHint}</p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={form.checklistMode} onChange={(e) => update({ checklistMode: e.target.checked })} />
          {t.checklistMode}
        </label>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.parseFailures}</label>
          <input type="number" min={1} max={20} className={inputClassName()} value={form.maxConsecutiveParseFailures} onChange={(e) => update({ maxConsecutiveParseFailures: Number(e.target.value) || 3 })} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.judgeTimeoutSec}</label>
          <input type="number" min={5} max={120} className={inputClassName()} value={form.judgeTimeoutSec} onChange={(e) => update({ judgeTimeoutSec: Number(e.target.value) || 60 })} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-fg">{t.checklistHistoryChars}</label>
          <input type="number" min={0} max={100000} className={inputClassName()} value={form.checklistHistoryChars} onChange={(e) => update({ checklistHistoryChars: Math.max(0, Math.min(100_000, Math.floor(Number(e.target.value) || 0))) })} />
          <p className="mt-1 text-xs text-fg-subtle">{t.checklistHistoryCharsHint}</p>
        </div>
      </div>
    </SettingsFormSection>
  );
}
