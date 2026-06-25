import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeSharePolicyFromConfig,
  patchSharePolicy,
  type SharePolicyState,
} from '@/features/shares/share-policy-api';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type SharesSettingsMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

type Props = {
  hasToken: boolean;
};

export function SharePolicySection({ hasToken }: Props) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined
        ? structuredClone(normalizeSharePolicyFromConfig(data.payload.config))
        : null,
    [data],
  );

  const dirtyRef = useRef(false);
  const [localDraft, setLocalDraft] = useState<SharePolicyState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const form = localDraft ?? parsed;
  const baseline = parsed;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<SharePolicyState>) => {
    dirtyRef.current = true;
    setLocalDraft((prev) => {
      const base = prev ?? baseline;
      return base ? { ...base, ...patch } : null;
    });
  }, [baseline]);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchSharePolicy(form);
      dirtyRef.current = false;
      setLocalDraft(null);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.policySaveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, t.policySaveError]);

  const discard = useCallback(() => {
    dirtyRef.current = false;
    setLocalDraft(null);
    setError(null);
    setSaveOk(false);
  }, []);

  if (!hasToken || !form) {
    if (isLoading) {
      return (
        <SettingsFormSection>
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" />
            {t.policyLoading}
          </p>
        </SettingsFormSection>
      );
    }
    return null;
  }

  return (
    <SettingsFormSection>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t.policyTitle}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{t.policyHint}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{t.policySaved}</span> : null}
          <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
            {t.policyDiscard}
          </Button>
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t.policySaving : t.policySave}
          </Button>
        </div>
      </div>

      {dirty ? <p className="mb-3 text-xs text-amber-800 dark:text-amber-200">{t.policyUnsaved}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <p className="mb-4 text-xs text-fg-subtle">{t.policyRestartHint}</p>

      <SharePolicyFields t={t} form={form} onChange={update} />
    </SettingsFormSection>
  );
}

function SharePolicyFields({
  t,
  form,
  onChange,
}: {
  t: SharesSettingsMessages;
  form: SharePolicyState;
  onChange: (patch: Partial<SharePolicyState>) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={form.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        {t.policyEnabled}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          id="share-default-ttl-hours"
          label={t.policyDefaultTtlHours}
          hint={t.policyDefaultTtlHint}
          value={form.defaultTtlHours}
          min={1}
          max={168}
          disabled={!form.enabled}
          onChange={(defaultTtlHours) => onChange({ defaultTtlHours })}
        />
        <NumberField
          id="share-max-ttl-days"
          label={t.policyMaxTtlDays}
          hint={t.policyMaxTtlHint}
          value={form.maxTtlDays}
          min={1}
          max={30}
          disabled={!form.enabled}
          onChange={(maxTtlDays) => onChange({ maxTtlDays })}
        />
        <NumberField
          id="share-max-active"
          label={t.policyMaxActiveShares}
          hint={t.policyMaxActiveSharesHint}
          value={form.maxActiveShares}
          min={1}
          max={10_000}
          disabled={!form.enabled}
          onChange={(maxActiveShares) => onChange({ maxActiveShares })}
        />
        <NumberField
          id="site-share-max-active"
          label={t.policyMaxActiveSites}
          hint={t.policyMaxActiveSitesHint}
          value={form.maxActiveSites}
          min={1}
          max={1_000}
          onChange={(maxActiveSites) => onChange({ maxActiveSites })}
        />
        <NumberField
          id="share-max-file-mb"
          label={t.policyMaxFileSizeMb}
          hint={t.policyMaxFileSizeHint}
          value={form.maxFileSizeMb}
          min={1}
          max={10_240}
          disabled={!form.enabled}
          onChange={(maxFileSizeMb) => onChange({ maxFileSizeMb })}
        />
      </div>

      <MimeListField
        t={t}
        values={form.inlinePreviewMimes}
        disabled={!form.enabled}
        onChange={(inlinePreviewMimes) => onChange({ inlinePreviewMimes })}
      />
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
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
        disabled={disabled}
        className={cn(inputClassName(), 'max-w-xs font-mono text-xs')}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.floor(n))));
        }}
      />
      <p className="mt-1 text-xs text-fg-subtle">{hint}</p>
    </div>
  );
}

function MimeListField({
  t,
  values,
  disabled,
  onChange,
}: {
  t: SharesSettingsMessages;
  values: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const addValue = (raw: string) => {
    const next = raw.trim();
    if (!next || values.includes(next) || values.length >= 32) return;
    onChange([...values, next]);
  };

  return (
    <div className="space-y-2 border-t border-edge pt-4">
      <div className="text-sm font-medium text-fg">{t.policyInlinePreviewMimes}</div>
      <p className="text-xs text-fg-subtle">{t.policyInlinePreviewMimesHint}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-panel px-2 py-0.5 font-mono text-xs text-fg"
          >
            {value}
            {!disabled ? (
              <button
                type="button"
                className="text-fg-muted hover:text-fg"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((x) => x !== value))}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
      <input
        className={cn(inputClassName(), 'font-mono text-xs')}
        placeholder={t.policyMimePlaceholder}
        disabled={disabled || values.length >= 32}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addValue((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = '';
          }
        }}
      />
    </div>
  );
}
