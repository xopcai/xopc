import { Database } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef } from 'react';

import { AutosaveStatus } from '@/components/ui/autosave-status';
import { Skeleton } from '@/components/ui/skeleton';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeSessionConfigFromConfig,
  patchSessionConfig,
  type SessionConfigState,
  type SessionDmScope,
} from '@/features/settings/session-config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { createFormDraftReducer, syncFormDraftFromParsed } from '@/lib/settings-form-draft';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useAutosave } from '@/lib/use-autosave';
import { Select, SelectOption } from '@/components/ui/popover-select';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

const sessionFormReducer = createFormDraftReducer<SessionConfigState>();

export function SessionConfigSection({ hasToken }: { hasToken: boolean }) {
  const t = messages(useLocaleStore((s) => s.language)).sessions.config;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const parsed = useMemo(
    () => (data?.payload?.config !== undefined ? normalizeSessionConfigFromConfig(data.payload.config) : null),
    [data],
  );
  const [formDraft, dispatchForm] = useReducer(sessionFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const dirtyRef = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const trackedParsedRef = useRef<SessionConfigState | null>(null);

  syncFormDraftFromParsed({
    enabled: hasToken,
    parsed,
    dirty: dirtyRef.current,
    trackedParsedRef,
    dispatch: dispatchForm,
    onResetDirty: () => {
      dirtyRef.current = false;
    },
  });

  const dirty = Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline));
  const update = useCallback((patch: Partial<SessionConfigState>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
  }, []);

  const save = useCallback(async (snapshot: SessionConfigState) => {
    try {
      await patchSessionConfig(snapshot);
      dispatchForm({ type: 'saved', value: snapshot });
      dirtyRef.current = Boolean(
        formRef.current && JSON.stringify(formRef.current) !== JSON.stringify(snapshot),
      );
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : t.saveError);
    }
  }, [t.saveError]);

  const autosave = useAutosave({ value: form, dirty, onSave: save });

  if (!hasToken || !form) {
    return isLoading ? (
      <SettingsFormSection>
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </SettingsFormSection>
    ) : null;
  }

  return (
    <SettingsFormSection onBlurCapture={autosave.onBlurCapture}>
      <SettingsFormSectionHeader icon={Database} title={t.title} subtitle={t.hint} trailing={<AutosaveStatus status={autosave.status} error={autosave.error} />} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-fg">{t.dmScope}</label>
          <Select className={inputClassName()} value={form.dmScope} onChange={(e) => update({ dmScope: e.target.value as SessionDmScope })}>
            <SelectOption value="main">{t.dmScopeMain}</SelectOption>
            <SelectOption value="per-peer">{t.dmScopePerPeer}</SelectOption>
            <SelectOption value="per-channel-peer">{t.dmScopePerChannelPeer}</SelectOption>
            <SelectOption value="per-account-channel-peer">{t.dmScopePerAccountChannelPeer}</SelectOption>
          </Select>
          <p className="mt-1 text-xs text-fg-subtle">{t.dmScopeHint}</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.pruneAfterDays}</label>
          <input
            type="number"
            min={0}
            className={inputClassName()}
            value={form.pruneAfterDays ?? ''}
            placeholder={t.unsetPlaceholder}
            onChange={(e) => {
              const raw = e.target.value.trim();
              update({ pruneAfterDays: raw === '' ? null : Math.max(0, Math.floor(Number(raw) || 0)) });
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.maxEntries}</label>
          <input
            type="number"
            min={1}
            className={inputClassName()}
            value={form.maxEntries ?? ''}
            placeholder={t.unsetPlaceholder}
            onChange={(e) => {
              const raw = e.target.value.trim();
              update({ maxEntries: raw === '' ? null : Math.max(1, Math.floor(Number(raw) || 1)) });
            }}
          />
        </div>
      </div>
    </SettingsFormSection>
  );
}
