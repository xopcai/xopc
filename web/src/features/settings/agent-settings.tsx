import { Cpu, Folder, Layers, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model-selector';
import { fetchAgentDefaults, patchAgentDefaults, type AgentDefaultsState } from '@/features/settings/config-api';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const THINKING_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'] as const;

function SettingsCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-edge bg-surface-panel shadow-sm dark:border-edge',
        'dark:shadow-none',
      )}
    >
      <div className="border-b border-edge-subtle px-4 py-3 dark:border-edge">
        <div className="flex items-start gap-3">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-base dark:border-edge"
            aria-hidden
          >
            <Icon className="size-4 text-fg-muted" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-5 px-4 py-4">{children}</div>
    </section>
  );
}

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

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-accent/30',
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(inputClassName(), 'cursor-pointer');
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAgentDefaults();
      setForm(data);
      setBaseline(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : a.loadError);
      setForm(null);
      setBaseline(null);
    } finally {
      setLoading(false);
    }
  }, [a.loadError]);

  useEffect(() => {
    if (!hasToken) {
      setLoading(false);
      setForm(null);
      setBaseline(null);
      return;
    }
    void load();
  }, [hasToken, load]);

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<AgentDefaultsState>) => {
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchAgentDefaults(form);
      setBaseline(form);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : a.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, a.saveError]);

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <div className="flex items-start gap-3 rounded-lg border border-edge bg-surface-panel p-6 dark:border-edge">
          <Cpu className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <h1 className="text-base font-semibold text-fg">{m.settingsSections.agent}</h1>
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
          {error ?? a.loadError}
        </p>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          {m.logs.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.agent}</h1>
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
        <SettingsCard icon={Cpu} title={a.cardModelsTitle} subtitle={a.cardModelsSubtitle}>
          <Field label={a.label.model} description={a.desc.model}>
            <ModelSelector
              value={form.model}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={chat.modelNoMatches}
              onChange={(modelId) => update({ model: modelId })}
            />
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
          <Field label={a.label.imageGenerationModel} description={a.desc.imageGenerationModel}>
            <ModelSelector
              value={form.imageGenerationModel}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={chat.modelNoMatches}
              onChange={(modelId) => update({ imageGenerationModel: modelId })}
            />
          </Field>
        </SettingsCard>

        <SettingsCard icon={Folder} title={a.cardWorkspaceTitle} subtitle={a.cardWorkspaceSubtitle}>
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
        </SettingsCard>

        <SettingsCard icon={Layers} title={a.cardGenerationTitle} subtitle={a.cardGenerationSubtitle}>
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
        </SettingsCard>

        <SettingsCard icon={Zap} title={a.cardBehaviorTitle} subtitle={a.cardBehaviorSubtitle}>
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
        </SettingsCard>
      </div>
    </div>
  );
}
