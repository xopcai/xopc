import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, type Dispatch, type SetStateAction } from 'react';

import { createFormDraftReducer, uiPatchReducer } from '@/lib/settings-form-draft';

import { Button } from '@/components/ui/button';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
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
import { useAgentDefaultsForm } from '../agents/use-agent-defaults-form';

import { ModelEditDialogContent } from './models-model-edit-dialog';
import { ProviderAddDialog } from './models-provider-add-dialog';
import {
  ModelsProvidersList,
  ModelsSettingsEmptyState,
  type ModelsTestResult,
} from './models-providers-list';
import { addProviderEntry, inputClassName, removeProvider, updateProvider } from './models-settings-lib';

const modelsFormReducer = createFormDraftReducer<ModelsJsonConfig>();

type ModelsUi = {
  path: string;
  loadMetaError: string | undefined;
  loading: boolean;
  saving: boolean;
  validating: boolean;
  reloading: boolean;
  error: string | null;
  saveOk: boolean;
  validation: ValidationResult | null;
  expanded: Set<string>;
  editorMode: 'guided' | 'expert';
  rawText: string;
  rawError: string | null;
  showPw: Set<string>;
  testResults: Map<string, ModelsTestResult>;
  providerDialogOpen: boolean;
  providerPreset: string | null;
  modelDialogOpen: boolean;
  modelDialogCtx: { providerId: string; model: CustomModel | null; isNew: boolean } | null;
};

const initialModelsUi: ModelsUi = {
  path: '',
  loadMetaError: undefined,
  loading: true,
  saving: false,
  validating: false,
  reloading: false,
  error: null,
  saveOk: false,
  validation: null,
  expanded: new Set(),
  editorMode: 'guided',
  rawText: '',
  rawError: null,
  showPw: new Set(),
  testResults: new Map(),
  providerDialogOpen: false,
  providerPreset: null,
  modelDialogOpen: false,
  modelDialogCtx: null,
};

/** See `WebSearchSettingsPanel` for the embedded-mode contract. */
export function ModelsSettingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const ms = m.modelsSettings;
  const agentVm = useAgentDefaultsForm(m.agentSettings);
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(modelsFormReducer, {
    form: { providers: {} },
    baseline: { providers: {} },
  });
  const config = formDraft.form ?? { providers: {} };
  const baseline = formDraft.baseline ?? { providers: {} };
  const [ui, dispatchUi] = useReducer(uiPatchReducer<ModelsUi>, initialModelsUi);
  const {
    path,
    loadMetaError,
    loading,
    saving,
    validating,
    reloading,
    error,
    saveOk,
    validation,
    expanded,
    editorMode,
    rawText,
    rawError,
    showPw,
    testResults,
    providerDialogOpen,
    providerPreset,
    modelDialogOpen,
    modelDialogCtx,
  } = ui;

  const setConfig = useCallback(
    (updater: ModelsJsonConfig | ((prev: ModelsJsonConfig) => ModelsJsonConfig)) => {
      dispatchForm({
        type: 'set-form',
        updater: (prev) => (typeof updater === 'function' ? updater(prev) : updater),
      });
    },
    [],
  );

  const load = useCallback(async (opts?: { skipFullPageLoading?: boolean }) => {
    const showFullPageLoading = !opts?.skipFullPageLoading;
    if (showFullPageLoading) {
      dispatchUi({ type: 'patch', patch: { loading: true } });
    }
    dispatchUi({ type: 'patch', patch: { error: null } });
    try {
      const st = await fetchModelsJson();
      const norm = normalizeModelsJsonConfig(st.config);
      dispatchForm({ type: 'sync', value: norm });
      dispatchUi({
        type: 'patch',
        patch: {
          path: st.path,
          loadMetaError: st.loadError,
          validation: null,
          saveOk: false,
        },
      });
    } catch (e) {
      dispatchUi({ type: 'patch', patch: { error: e instanceof Error ? e.message : ms.loadError } });
      dispatchForm({ type: 'sync', value: { providers: {} } });
    } finally {
      if (showFullPageLoading) {
        dispatchUi({ type: 'patch', patch: { loading: false } });
      }
    }
  }, [ms.loadError]);

  useEffect(() => {
    if (!hasToken) {
      dispatchUi({ type: 'patch', patch: { loading: false } });
      return;
    }
    void load();
  }, [hasToken, load]);

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(baseline),
    [config, baseline],
  );

  // The chat-model fallback chain lives under Agent defaults > Model strategy,
  // so this panel no longer renders or
  // saves agent defaults. We still load `useAgentDefaultsForm` above
  // because the agent-defaults page may not be mounted yet — invoking the
  // hook here keeps the form's SWR cache warm for fast cross-tab load —
  // but the dirty/save coordination below is intentionally left in place
  // and degrades to no-op (`agentVm.dirty` stays false).
  const combinedDirty = dirty || agentVm.dirty;

  const stats = useMemo(() => {
    const ids = Object.keys(config.providers);
    let models = 0;
    for (const p of Object.values(config.providers)) {
      models += p.models?.length ?? 0;
    }
    return { providers: ids.length, models };
  }, [config.providers]);

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    dispatchUi({ type: 'patch', patch: { expanded: next } });
  };

  const toggleShowPw = (id: string) => {
    const next = new Set(showPw);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    dispatchUi({ type: 'patch', patch: { showPw: next } });
  };

  const syncRawFromConfig = useCallback(() => {
    dispatchUi({
      type: 'patch',
      patch: { rawText: JSON.stringify(config, null, 2), rawError: null },
    });
  }, [config]);

  const selectEditorMode = useCallback(
    (mode: 'guided' | 'expert') => {
      dispatchUi({
        type: 'patch',
        patch:
          mode === 'expert'
            ? { editorMode: mode, rawText: JSON.stringify(config, null, 2), rawError: null }
            : { editorMode: mode },
      });
    },
    [config],
  );

  const applyRawJson = () => {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const norm = normalizeModelsJsonConfig(parsed);
      setConfig(norm);
      dispatchUi({ type: 'patch', patch: { rawError: null } });
    } catch {
      dispatchUi({ type: 'patch', patch: { rawError: ms.jsonParseError } });
    }
  };

  const runValidate = async () => {
    dispatchUi({ type: 'patch', patch: { validating: true, error: null } });
    try {
      const r = await validateModelsJson(config);
      dispatchUi({ type: 'patch', patch: { validation: r } });
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { error: e instanceof Error ? e.message : ms.validateError },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { validating: false } });
    }
  };

  const runSave = async () => {
    if (saving || agentVm.saving) return;
    const hadJsonDirty = dirty;
    const hadAgentDirty = agentVm.dirty;
    if (!hadJsonDirty && !hadAgentDirty) return;

    dispatchUi({ type: 'patch', patch: { error: null, saveOk: false } });
    try {
      if (hadJsonDirty) {
        dispatchUi({ type: 'patch', patch: { saving: true } });
        try {
          await saveModelsJson(config);
          dispatchForm({ type: 'saved', value: structuredClone(config) });
          dispatchUi({ type: 'patch', patch: { validation: null } });
        } finally {
          dispatchUi({ type: 'patch', patch: { saving: false } });
        }
      }
      if (hadAgentDirty && agentVm.form) {
        const agentOk = await agentVm.save();
        if (!agentOk) {
          throw new Error(m.agentSettings.saveError);
        }
      }
      dispatchUi({ type: 'patch', patch: { saveOk: true } });
    } catch (e) {
      dispatchUi({ type: 'patch', patch: { error: e instanceof Error ? e.message : ms.saveError } });
    }
  };

  const runDiscard = useCallback(() => {
    dispatchForm({ type: 'discard' });
    dispatchUi({
      type: 'patch',
      patch: {
        validation: null,
        saveOk: false,
        error: null,
        ...(editorMode === 'expert'
          ? { rawText: JSON.stringify(baseline, null, 2), rawError: null }
          : {}),
      },
    });
    agentVm.discard();
  }, [baseline, editorMode, agentVm]);

  useSaveBarRegistration({
    id: 'models',
    dirty: combinedDirty,
    saving: saving || agentVm.saving,
    save: runSave,
    discard: runDiscard,
  });

  const runReload = async () => {
    dispatchUi({ type: 'patch', patch: { reloading: true, error: null } });
    try {
      await reloadModelsJson();
      await load({ skipFullPageLoading: true });
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { error: e instanceof Error ? e.message : ms.reloadError },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { reloading: false } });
    }
  };

  const runTestKey = async (providerId: string, value: string) => {
    try {
      const r = await testApiKey(value);
      const next = new Map(testResults);
      next.set(providerId, r);
      dispatchUi({ type: 'patch', patch: { testResults: next } });
    } catch (e) {
      const next = new Map(testResults);
      next.set(providerId, {
        type: 'error',
        error: e instanceof Error ? e.message : 'Error',
      });
      dispatchUi({ type: 'patch', patch: { testResults: next } });
    }
  };

  const openAddProvider = (preset: string | null = null) => {
    dispatchUi({ type: 'patch', patch: { providerPreset: preset, providerDialogOpen: true } });
  };

  const onProviderAdded = (providerId: string, prov: ProviderConfig) => {
    setConfig((c) => addProviderEntry(c, providerId, prov));
    dispatchUi({ type: 'patch', patch: { expanded: new Set(expanded).add(providerId) } });
  };

  const removeProv = (providerId: string) => {
    if (!window.confirm(ms.removeProviderConfirm.replace('{{id}}', providerId))) return;
    setConfig((c) => removeProvider(c, providerId));
    const next = new Map(testResults);
    next.delete(providerId);
    dispatchUi({ type: 'patch', patch: { testResults: next } });
  };

  const openModelDialog = (providerId: string, model: CustomModel | null, isNew: boolean) => {
    dispatchUi({
      type: 'patch',
      patch: { modelDialogCtx: { providerId, model, isNew }, modelDialogOpen: true },
    });
  };

  const patchTestResults = useCallback<Dispatch<SetStateAction<Map<string, ModelsTestResult>>>>(
    (value) => {
      const next = typeof value === 'function' ? value(testResults) : value;
      dispatchUi({ type: 'patch', patch: { testResults: next } });
    },
    [testResults],
  );

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

  const outerClass = embedded
    ? 'flex flex-col gap-4'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-8';
  const compactClass = embedded
    ? 'flex flex-col gap-3'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8';

  if (!hasToken) {
    return (
      <div className={compactClass}>
        {embedded ? null : <h1 className="text-lg font-semibold text-fg">{m.settingsSections.models}</h1>}
        <p className="text-sm text-fg-muted">{ms.needToken}</p>
      </div>
    );
  }

  return (
    <div className={outerClass}>
      {embedded ? null : (
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
      )}

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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex rounded-lg border border-edge-subtle bg-surface-panel p-0.5"
          role="tablist"
          aria-label={ms.modeGuided}
        >
          {(['guided', 'expert'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={editorMode === mode}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                interaction.press,
                editorMode === mode
                  ? 'bg-accent-soft text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
              onClick={() => {
                selectEditorMode(mode);
                dispatchUi({ type: 'patch', patch: { rawError: null } });
              }}
            >
              {mode === 'guided' ? ms.modeGuided : ms.modeExpert}
            </button>
          ))}
        </div>
        <p className="text-xs text-fg-muted">
          {editorMode === 'guided' ? ms.modeGuidedHint : ms.modeExpertHint}
        </p>
      </div>

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
        {/* Hide Discard / Save in embedded mode — global Save bar handles them. */}
        {embedded ? null : (
          <>
            <Button
              type="button"
              variant="secondary"
              className="inline-flex min-h-9 min-w-[7.5rem] justify-center"
              onClick={runDiscard}
              disabled={loading || saving || agentVm.saving || !combinedDirty}
            >
              {ms.discard}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="inline-flex min-h-9 min-w-[7.5rem] justify-center"
              onClick={() => void runSave()}
              disabled={loading || saving || agentVm.saving || !combinedDirty}
            >
              {saving || agentVm.saving ? (
                <>
                  <Loader2 className="mr-1 size-4 animate-spin" />
                  {ms.saving}
                </>
              ) : (
                ms.save
              )}
            </Button>
          </>
        )}
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

      {combinedDirty && !embedded ? <p className="text-xs text-amber-800 dark:text-amber-200">{ms.unsavedHint}</p> : null}
      {saveOk || agentVm.saveOk ? (
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
      {agentVm.error ? (
        <p className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400" role="alert">
          <AlertCircle className="size-4 shrink-0" />
          {agentVm.error}
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
            {validation.errors.map((err) => (
              <li key={`${err.path}-${err.severity}-${err.message}`}>
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
      ) : editorMode === 'expert' ? (
        <div className="flex flex-col gap-2">
          <textarea
            className={cn(
              inputClassName(),
              'min-h-[320px] resize-y font-mono text-xs leading-relaxed',
            )}
            value={rawText}
            onChange={(e) => dispatchUi({ type: 'patch', patch: { rawText: e.target.value } })}
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
          setTestResults={patchTestResults}
        />
      )}

      <ProviderAddDialog
        open={providerDialogOpen}
        onOpenChange={(open) => dispatchUi({ type: 'patch', patch: { providerDialogOpen: open } })}
        presetKey={providerPreset}
        onConfirm={onProviderAdded}
        m={ms}
      />

      <ModelEditDialogContent
        open={modelDialogOpen}
        onOpenChange={(o) => {
          dispatchUi({
            type: 'patch',
            patch: { modelDialogOpen: o, ...(o ? {} : { modelDialogCtx: null }) },
          });
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
