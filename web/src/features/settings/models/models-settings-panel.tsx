import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  fetchModelsJson,
  normalizeModelsJsonConfig,
  reloadModelsJson,
  saveModelsJson,
  testApiKey,
  validateModelsJson,
  type CustomModel,
  type ModelsJsonConfig,
  type ProviderConfig,
  type ValidationResult,
} from '../models-json-api';

import { ModelEditDialogContent } from './models-model-edit-dialog';
import { ProviderAddDialog } from './models-provider-add-dialog';
import {
  ModelsProvidersList,
  ModelsSettingsEmptyState,
  type ModelsTestResult,
} from './models-providers-list';
import { addProviderEntry, inputClassName, removeProvider, updateProvider } from './models-settings-lib';

export function ModelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const ms = m.modelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [config, setConfig] = useState<ModelsJsonConfig>({ providers: {} });
  const [baseline, setBaseline] = useState<ModelsJsonConfig>({ providers: {} });
  const [path, setPath] = useState('');
  const [loadMetaError, setLoadMetaError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState<Set<string>>(() => new Set());
  const [testResults, setTestResults] = useState<Map<string, ModelsTestResult>>(() => new Map());

  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerPreset, setProviderPreset] = useState<string | null>(null);

  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelDialogCtx, setModelDialogCtx] = useState<{
    providerId: string;
    model: CustomModel | null;
    isNew: boolean;
  } | null>(null);

  const load = useCallback(async (opts?: { skipFullPageLoading?: boolean }) => {
    const showFullPageLoading = !opts?.skipFullPageLoading;
    if (showFullPageLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const st = await fetchModelsJson();
      const norm = normalizeModelsJsonConfig(st.config);
      setConfig(norm);
      setBaseline(structuredClone(norm));
      setPath(st.path);
      setLoadMetaError(st.loadError);
      setValidation(null);
      setSaveOk(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : ms.loadError);
      setConfig({ providers: {} });
      setBaseline({ providers: {} });
    } finally {
      if (showFullPageLoading) {
        setLoading(false);
      }
    }
  }, [ms.loadError]);

  useEffect(() => {
    if (!hasToken) {
      setLoading(false);
      return;
    }
    void load();
  }, [hasToken, load]);

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(baseline),
    [config, baseline],
  );

  const stats = useMemo(() => {
    const ids = Object.keys(config.providers);
    let models = 0;
    for (const p of Object.values(config.providers)) {
      models += p.models?.length ?? 0;
    }
    return { providers: ids.length, models };
  }, [config.providers]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleShowPw = (id: string) => {
    setShowPw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const syncRawFromConfig = useCallback(() => {
    setRawText(JSON.stringify(config, null, 2));
    setRawError(null);
  }, [config]);

  useEffect(() => {
    if (showRawJson) syncRawFromConfig();
  }, [showRawJson, syncRawFromConfig]);

  const applyRawJson = () => {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const norm = normalizeModelsJsonConfig(parsed);
      setConfig(norm);
      setRawError(null);
    } catch {
      setRawError(ms.jsonParseError);
    }
  };

  const runValidate = async () => {
    setValidating(true);
    setError(null);
    try {
      const r = await validateModelsJson(config);
      setValidation(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : ms.validateError);
    } finally {
      setValidating(false);
    }
  };

  const runSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await saveModelsJson(config);
      setBaseline(structuredClone(config));
      setSaveOk(true);
      setValidation(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : ms.saveError);
    } finally {
      setSaving(false);
    }
  };

  const runReload = async () => {
    setReloading(true);
    setError(null);
    try {
      await reloadModelsJson();
      await load({ skipFullPageLoading: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : ms.reloadError);
    } finally {
      setReloading(false);
    }
  };

  const runTestKey = async (providerId: string, value: string) => {
    try {
      const r = await testApiKey(value);
      setTestResults((prev) => {
        const next = new Map(prev);
        next.set(providerId, r);
        return next;
      });
    } catch (e) {
      setTestResults((prev) => {
        const next = new Map(prev);
        next.set(providerId, {
          type: 'error',
          error: e instanceof Error ? e.message : 'Error',
        });
        return next;
      });
    }
  };

  const openAddProvider = (preset: string | null = null) => {
    setProviderPreset(preset);
    setProviderDialogOpen(true);
  };

  const onProviderAdded = (providerId: string, prov: ProviderConfig) => {
    setConfig((c) => addProviderEntry(c, providerId, prov));
    setExpanded((prev) => new Set(prev).add(providerId));
  };

  const removeProv = (providerId: string) => {
    if (!window.confirm(ms.removeProviderConfirm.replace('{{id}}', providerId))) return;
    setConfig((c) => removeProvider(c, providerId));
    setTestResults((prev) => {
      const next = new Map(prev);
      next.delete(providerId);
      return next;
    });
  };

  const openModelDialog = (providerId: string, model: CustomModel | null, isNew: boolean) => {
    setModelDialogCtx({ providerId, model, isNew });
    setModelDialogOpen(true);
  };

  const onModelSaved = (updated: CustomModel) => {
    if (!modelDialogCtx) return;
    const { providerId, isNew } = modelDialogCtx;
    setConfig((c) => {
      const p = c.providers[providerId];
      if (!p) return c;
      const models = p.models || [];
      if (isNew) {
        return updateProvider(c, providerId, { models: [...models, updated] });
      }
      return updateProvider(c, providerId, {
        models: models.map((mm) => (mm.id === updated.id ? updated : mm)),
      });
    });
  };

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.models}</h1>
        <p className="text-sm text-fg-muted">{ms.needToken}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.models}</h1>
        <p className="text-sm text-fg-muted">{ms.subtitle}</p>
        <a
          href={docsGuidePageUrl(language, 'models')}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {ms.docsLink}
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      {loadMetaError ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{ms.loadFileWarning}: {loadMetaError}</span>
        </div>
      ) : null}

      {path ? (
        <p className="text-xs text-fg-subtle">
          {ms.filePath}: <code className="rounded bg-surface-base px-1 py-0.5 font-mono text-fg-muted">{path}</code>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="bg-accent text-white hover:bg-accent/90"
          onClick={() => openAddProvider(null)}
          disabled={loading}
        >
          <Plus className="mr-1 size-4" />
          {ms.addProvider}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="inline-flex min-h-9 min-w-[7.5rem] justify-center"
          onClick={runValidate}
          disabled={loading || validating}
        >
          {validating ? (
            <>
              <Loader2 className="mr-1 size-4 animate-spin" />
              {ms.validating}
            </>
          ) : (
            ms.validate
          )}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="inline-flex min-h-9 min-w-[7.5rem] justify-center"
          onClick={runSave}
          disabled={loading || saving || !dirty}
        >
          {saving ? (
            <>
              <Loader2 className="mr-1 size-4 animate-spin" />
              {ms.saving}
            </>
          ) : (
            ms.save
          )}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="inline-flex min-h-9 min-w-[8.5rem] justify-center"
          onClick={runReload}
          disabled={loading || reloading}
        >
          {reloading ? (
            <>
              <Loader2 className="mr-1 size-4 animate-spin" />
              {ms.reloading}
            </>
          ) : (
            <>
              <RefreshCw className="mr-1 size-4" />
              {ms.reload}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-fg-muted"
          onClick={() => {
            setShowRawJson((v) => !v);
            setRawError(null);
          }}
        >
          {showRawJson ? ms.hideJson : ms.showJson}
        </Button>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-1.5 text-sm dark:border-edge">
          <span className="text-fg-muted">
            {ms.statsProviders.replace('{{count}}', String(stats.providers))}
          </span>
          <span className="text-fg-subtle">|</span>
          <span className="text-fg-muted">
            {ms.statsModels.replace('{{count}}', String(stats.models))}
          </span>
        </div>
      </div>

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{ms.unsavedHint}</p> : null}
      {saveOk ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
          {ms.saved}
        </p>
      ) : null}
      {error ? (
        <p className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400" role="alert">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {validation && validation.errors.length > 0 ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30"
          role="status"
        >
          <p className="mb-1 text-sm font-medium text-amber-950 dark:text-amber-100">
            {validation.valid ? ms.validationWarnings : ms.validationErrors}
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-900 dark:text-amber-200">
            {validation.errors.map((err, i) => (
              <li key={`${err.path}-${i}`}>
                {err.path}: {err.message} ({err.severity})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          {ms.loading}
        </div>
      ) : showRawJson ? (
        <div className="flex flex-col gap-2">
          <textarea
            className={cn(
              inputClassName(),
              'min-h-[320px] resize-y font-mono text-xs leading-relaxed',
            )}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
          />
          {rawError ? <p className="text-xs text-red-600 dark:text-red-400">{rawError}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={syncRawFromConfig}>
              {ms.jsonReset}
            </Button>
            <Button type="button" className="bg-accent text-white hover:bg-accent/90" onClick={applyRawJson}>
              {ms.jsonApply}
            </Button>
          </div>
        </div>
      ) : Object.keys(config.providers).length === 0 ? (
        <ModelsSettingsEmptyState ms={ms} openAddProvider={openAddProvider} />
      ) : (
        <ModelsProvidersList
          config={config}
          setConfig={setConfig}
          expanded={expanded}
          toggleExpand={toggleExpand}
          showPw={showPw}
          toggleShowPw={toggleShowPw}
          testResults={testResults}
          runTestKey={runTestKey}
          ms={ms}
          removeProv={removeProv}
          openModelDialog={openModelDialog}
          setTestResults={setTestResults}
        />
      )}

      <ProviderAddDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        presetKey={providerPreset}
        onConfirm={onProviderAdded}
        m={ms}
      />

      <ModelEditDialogContent
        open={modelDialogOpen}
        onOpenChange={(o) => {
          setModelDialogOpen(o);
          if (!o) setModelDialogCtx(null);
        }}
        providerId={modelDialogCtx?.providerId ?? null}
        model={modelDialogCtx?.model ?? null}
        isNew={modelDialogCtx?.isNew ?? false}
        onSave={onModelSaved}
        m={ms}
      />
    </div>
  );
}
