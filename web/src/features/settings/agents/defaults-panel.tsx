import { Cpu, Folder, Globe, Layers, Plus, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model-selector';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  parseAgentDefaultsFromConfig,
  parseParamsJsonForSave,
  patchAgentDefaults,
  type AgentDefaultsState,
} from '@/features/settings/config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsExtraFields } from './agent-defaults-extra';
import { inputClassName, selectClassName } from './defaults-field-styles';

const THINKING_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'] as const;

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

export function AgentSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentSettings;
  const chat = m.chat;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<AgentDefaultsState | null>(null);
  const [baseline, setBaseline] = useState<AgentDefaultsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const dirtyRef = useRef(false);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? parseAgentDefaultsFromConfig(data.payload.config) : null,
    [data],
  );

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      dirtyRef.current = false;
      return;
    }
    if (parsed === null) return;
    if (!dirtyRef.current) {
      setForm(parsed);
      setBaseline(parsed);
    }
  }, [hasToken, parsed]);

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<AgentDefaultsState>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      try {
        void parseParamsJsonForSave(form.paramsJson);
      } catch (e) {
        setError(
          e instanceof SyntaxError
            ? a.advanced.paramsInvalidJson
            : e instanceof Error
              ? e.message
              : a.advanced.paramsInvalidJson,
        );
        return;
      }
      await patchAgentDefaults(form);
      dirtyRef.current = false;
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : a.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, a.saveError, a.advanced]);

  const pageTitle = m.settingsSections['agent-defaults'];

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <Cpu className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <h1 className="text-base font-semibold text-fg">{pageTitle}</h1>
            <p className="mt-1 text-sm text-fg-muted">{a.needToken}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{m.logs.loading}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <p className="text-sm text-fg-muted">
          {error ?? fetchError ?? a.loadError}
        </p>
        <Button type="button" variant="secondary" onClick={() => void mutate()}>
          {m.logs.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{pageTitle}</h1>
          <p className="mt-1 text-sm text-fg-muted">{a.subtitle}</p>
          <p className="mt-1 text-xs text-fg-subtle">{a.sectionDesc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{a.saved}</span> : null}
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? a.saving : a.save}
          </Button>
        </div>
      </header>

      {error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        <SettingsFormSection>
          <SettingsFormSectionHeader icon={Cpu} title={a.cardModelsTitle} subtitle={a.cardModelsSubtitle} />
          <div className="flex flex-col gap-5">
          <Field label={a.label.model} description={a.desc.model}>
            <ModelSelector
              value={form.model}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={chat.modelNoMatches}
              onChange={(modelId) => update({ model: modelId })}
            />
          </Field>
          <Field label={a.label.modelFallbacks} description={a.desc.modelFallbacks}>
            <div className="flex flex-col gap-2">
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
          </Field>
          <Field label={a.label.imageModel} description={a.desc.imageModel}>
            <ModelSelector
              value={form.imageModel}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={chat.modelNoMatches}
              onChange={(modelId) => update({ imageModel: modelId })}
            />
          </Field>
          <Field label={a.label.imageModelFallbacks} description={a.desc.imageModelFallbacks}>
            <div className="flex flex-col gap-2">
              {form.imageModelFallbacks.map((fb, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ModelSelector
                      value={fb}
                      placeholder={chat.modelPlaceholder}
                      searchPlaceholder={chat.modelSearchPlaceholder}
                      noMatches={chat.modelNoMatches}
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
          </Field>
          <Field label={a.label.imageGenerationModel} description={a.desc.imageGenerationModel}>
            <ModelSelector
              value={form.imageGenerationModel}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={chat.modelNoMatches}
              onChange={(modelId) => update({ imageGenerationModel: modelId })}
            />
          </Field>
          <Field
            label={a.label.imageGenerationModelFallbacks}
            description={a.desc.imageGenerationModelFallbacks}
          >
            <div className="flex flex-col gap-2">
              {form.imageGenerationModelFallbacks.map((fb, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ModelSelector
                      value={fb}
                      placeholder={chat.modelPlaceholder}
                      searchPlaceholder={chat.modelSearchPlaceholder}
                      noMatches={chat.modelNoMatches}
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
          </Field>
          </div>
        </SettingsFormSection>

        <SettingsFormSection>
          <SettingsFormSectionHeader icon={Folder} title={a.cardWorkspaceTitle} subtitle={a.cardWorkspaceSubtitle} />
          <div className="flex flex-col gap-5">
          <Field label={a.label.workspace} description={a.desc.workspace}>
            <input
              type="text"
              className={inputClassName()}
              value={form.workspace}
              onChange={(e) => update({ workspace: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label={a.label.mediaMaxMb} description={a.desc.mediaMaxMb}>
            <input
              type="number"
              min={1}
              step={1}
              className={inputClassName()}
              value={form.mediaMaxMb ?? ''}
              placeholder="20"
              onChange={(e) => {
                const v = e.target.value;
                update({ mediaMaxMb: v === '' ? undefined : Number(v) });
              }}
            />
            </Field>
          </div>
        </SettingsFormSection>

        <SettingsFormSection>
          <SettingsFormSectionHeader icon={Globe} title={a.cardBrowserTitle} subtitle={a.cardBrowserSubtitle} />
          <div className="flex flex-col gap-5">
            <Field label={a.label.browserEnabled} description={a.desc.browserEnabled}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserEnabled}
                  onChange={(e) => update({ browserEnabled: e.target.checked })}
                />
                <span>{a.browserEnabledOn}</span>
              </label>
            </Field>
            <Field label={a.label.browserHeadless} description={a.desc.browserHeadless}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserHeadless}
                  onChange={(e) => update({ browserHeadless: e.target.checked })}
                />
                <span>{a.browserHeadlessOn}</span>
              </label>
            </Field>
          </div>
        </SettingsFormSection>

        <SettingsFormSection>
          <SettingsFormSectionHeader icon={Layers} title={a.cardGenerationTitle} subtitle={a.cardGenerationSubtitle} />
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={a.label.maxTokens} description={a.desc.maxTokens}>
                <input
                  type="number"
                  className={inputClassName()}
                  value={form.maxTokens}
                  min={1}
                  onChange={(e) => update({ maxTokens: Number.parseInt(e.target.value, 10) || 0 })}
                />
              </Field>
              <Field label={a.label.temperature} description={a.desc.temperature}>
                <input
                  type="number"
                  className={inputClassName()}
                  value={form.temperature}
                  min={0}
                  max={2}
                  step={0.1}
                  onChange={(e) => update({ temperature: Number.parseFloat(e.target.value) || 0 })}
                />
              </Field>
            </div>
            <Field label={a.label.maxToolIterations} description={a.desc.maxToolIterations}>
              <input
                type="number"
                className={inputClassName()}
                value={form.maxToolIterations}
                min={1}
                onChange={(e) => update({ maxToolIterations: Number.parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
          </div>
        </SettingsFormSection>

        <SettingsFormSection>
          <SettingsFormSectionHeader icon={Zap} title={a.cardBehaviorTitle} subtitle={a.cardBehaviorSubtitle} />
          <div className="flex flex-col gap-5">
          <Field label={a.label.thinkingDefault} description={a.desc.thinkingDefault}>
            <select
              className={selectClassName()}
              value={form.thinkingDefault}
              onChange={(e) => update({ thinkingDefault: e.target.value })}
            >
              {THINKING_KEYS.map((k) => (
                <option key={k} value={k}>
                  {chat.thinkingLevels[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.label.reasoningDefault} description={a.desc.reasoningDefault}>
            <select
              className={selectClassName()}
              value={form.reasoningDefault}
              onChange={(e) => update({ reasoningDefault: e.target.value })}
            >
              <option value="off">{a.reasoning.off}</option>
              <option value="on">{a.reasoning.on}</option>
              <option value="stream">{a.reasoning.stream}</option>
            </select>
          </Field>
          <Field label={a.label.verboseDefault} description={a.desc.verboseDefault}>
            <select
              className={selectClassName()}
              value={form.verboseDefault}
              onChange={(e) => update({ verboseDefault: e.target.value })}
            >
              <option value="off">{a.verbose.off}</option>
              <option value="on">{a.verbose.on}</option>
              <option value="full">{a.verbose.full}</option>
            </select>
          </Field>
          </div>
        </SettingsFormSection>

        <AgentDefaultsExtraFields a={a} chat={chat} form={form} update={update} />
      </div>
    </div>
  );
}
