import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { messages, type ModelsSettingsMessages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  API_TYPE_OPTIONS,
  createCustomModel,
  fetchModelsJson,
  getApiKeyType,
  maskApiKey,
  normalizeModelsJsonConfig,
  reloadModelsJson,
  saveModelsJson,
  testApiKey,
  validateModelsJson,
  type ApiType,
  type CustomModel,
  type ModelsJsonConfig,
  type ProviderConfig,
  type ValidationResult,
} from './models-json-api';

const DOCS_URL = 'https://github.com/xopc/xopcbot/blob/main/docs/models.md';

const PROVIDER_PRESETS: Record<string, Partial<ProviderConfig>> = {
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    api: 'openai-completions',
    apiKey: 'ollama',
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    api: 'openai-completions',
    apiKey: 'lmstudio',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    apiKey: '',
  },
};

const INPUT_OPTIONS = [
  { value: 'text', labelKey: 'inputTextOnly' as const },
  { value: 'text,image', labelKey: 'inputTextVision' as const },
];

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

function parseInputSelect(model: CustomModel): string {
  const i = model.input || ['text'];
  if (i.includes('image')) return 'text,image';
  return 'text';
}

function inputFromSelect(sel: string): ('text' | 'image')[] {
  if (sel === 'text,image') return ['text', 'image'];
  return ['text'];
}

function updateProvider(
  config: ModelsJsonConfig,
  providerId: string,
  updates: Partial<ProviderConfig>,
): ModelsJsonConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...config.providers[providerId],
        ...updates,
      },
    },
  };
}

function removeProvider(config: ModelsJsonConfig, providerId: string): ModelsJsonConfig {
  const providers = { ...config.providers };
  delete providers[providerId];
  return { ...config, providers };
}

function addProviderEntry(
  config: ModelsJsonConfig,
  providerId: string,
  prov: ProviderConfig,
): ModelsJsonConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: prov,
    },
  };
}

type ProviderDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetKey?: string | null;
  onConfirm: (providerId: string, prov: ProviderConfig) => void;
  m: ModelsSettingsMessages;
};

function ProviderAddDialog({ open, onOpenChange, presetKey, onConfirm, m }: ProviderDialogProps) {
  const [providerId, setProviderId] = useState('');
  const [preset, setPreset] = useState('custom');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState<ApiType>('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const pk = presetKey || null;
    if (pk && PROVIDER_PRESETS[pk]) {
      const p = PROVIDER_PRESETS[pk];
      setPreset(pk);
      setBaseUrl(p.baseUrl || '');
      setApi((p.api as ApiType) || 'openai-completions');
      setApiKey(p.apiKey ?? '');
      setProviderId(pk === 'openrouter' ? 'openrouter' : pk);
    } else {
      setPreset('custom');
      setProviderId('');
      setBaseUrl('');
      setApi('openai-completions');
      setApiKey('');
    }
  }, [open, presetKey]);

  const applyPreset = (key: string) => {
    setPreset(key);
    if (key === 'custom') return;
    const p = PROVIDER_PRESETS[key];
    if (!p) return;
    setBaseUrl(p.baseUrl || '');
    setApi((p.api as ApiType) || 'openai-completions');
    setApiKey(p.apiKey ?? '');
  };

  const handleSubmit = () => {
    const id = providerId.trim();
    if (!id) {
      setError(m.providerIdRequired);
      return;
    }
    setError(null);
    onConfirm(id, {
      baseUrl: baseUrl.trim() || undefined,
      api,
      apiKey: apiKey.trim() || undefined,
      models: [],
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopcbot-dialog-content fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,640px)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2',
            'overflow-y-auto rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{m.addProviderTitle}</Dialog.Title>
              <p className="mt-0.5 text-xs text-fg-muted">{m.addProviderSubtitle}</p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={m.close}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{m.presetLabel}</label>
              <select
                className={selectClassName()}
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="custom">{m.presetCustom}</option>
                <option value="ollama">{m.presetOllama}</option>
                <option value="lmstudio">{m.presetLmStudio}</option>
                <option value="openrouter">{m.presetOpenRouter}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">
                {m.providerIdLabel}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </label>
              <input
                className={inputClassName()}
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                placeholder={m.providerIdPlaceholder}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.baseUrl}</label>
                <input
                  className={inputClassName()}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.apiType}</label>
                <select
                  className={selectClassName()}
                  value={api}
                  onChange={(e) => setApi(e.target.value as ApiType)}
                >
                  {API_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{m.apiKey}</label>
              <input
                className={inputClassName()}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={m.apiKeyPlaceholder}
              />
            </div>
            {error ? (
              <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="size-3.5 shrink-0" />
                {error}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-edge-subtle pt-3 dark:border-edge">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                {m.cancel}
              </Button>
            </Dialog.Close>
            <Button type="button" className="bg-accent text-white hover:bg-accent/90" onClick={handleSubmit}>
              {m.addProviderConfirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type ModelDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  providerId: string | null;
  model: CustomModel | null;
  isNew: boolean;
  onSave: (model: CustomModel) => void;
  m: ModelsSettingsMessages;
};

function ModelEditDialogContent({
  open,
  onOpenChange,
  providerId,
  model,
  isNew,
  onSave,
  m,
}: ModelDialogProps) {
  const [form, setForm] = useState<Partial<CustomModel>>(() => createCustomModel(''));
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!open) return;
    setErrors(new Map());
    setForm(model ? { ...model } : createCustomModel(''));
  }, [open, model]);

  const update = <K extends keyof CustomModel>(field: K, value: CustomModel[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(field as string);
      return next;
    });
  };

  const validate = (): boolean => {
    const next = new Map<string, string>();
    const id = (form.id || '').trim();
    if (!id) next.set('id', m.modelIdRequired);
    if (form.contextWindow !== undefined && form.contextWindow <= 0) {
      next.set('contextWindow', m.mustBePositive);
    }
    if (form.maxTokens !== undefined && form.maxTokens <= 0) {
      next.set('maxTokens', m.mustBePositive);
    }
    setErrors(next);
    return next.size === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const id = (form.id || '').trim();
    const result: CustomModel = {
      ...form,
      id,
      name: form.name?.trim() || id,
      reasoning: form.reasoning || false,
      input: form.input || ['text'],
      contextWindow: form.contextWindow ?? 128000,
      maxTokens: form.maxTokens ?? 16384,
      cost: {
        input: form.cost?.input ?? 0,
        output: form.cost?.output ?? 0,
        cacheRead: form.cost?.cacheRead ?? 0,
        cacheWrite: form.cost?.cacheWrite ?? 0,
      },
    };
    onSave(result);
    onOpenChange(false);
  };

  const inputSel = parseInputSelect(form as CustomModel);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopcbot-dialog-content fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,720px)] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
            'overflow-y-auto rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">
                {isNew ? m.addModelTitle : m.editModelTitle}
              </Dialog.Title>
              {providerId ? (
                <p className="mt-0.5 text-xs text-fg-muted">
                  {m.modelProviderLabel}: {providerId}
                </p>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={m.close}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">
                {m.modelId}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </label>
              <input
                className={cn(inputClassName(), errors.has('id') && 'border-red-500')}
                value={form.id || ''}
                onChange={(e) => update('id', e.target.value)}
                placeholder="e.g. llama3.1:8b"
                disabled={!isNew}
              />
              {errors.has('id') ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.get('id')}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{m.displayName}</label>
              <input
                className={inputClassName()}
                value={form.name || ''}
                onChange={(e) => update('name', e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.inputTypes}</label>
                <select
                  className={selectClassName()}
                  value={inputSel}
                  onChange={(e) => update('input', inputFromSelect(e.target.value))}
                >
                  {INPUT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {m[opt.labelKey]}
                    </option>
                  ))}
                </select>
              </div>
              <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-4 rounded border-edge text-accent focus:ring-accent/30"
                  checked={form.reasoning || false}
                  onChange={(e) => update('reasoning', e.target.checked)}
                />
                {m.reasoning}
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.contextWindow}</label>
                <input
                  type="number"
                  min={1}
                  className={cn(inputClassName(), errors.has('contextWindow') && 'border-red-500')}
                  value={form.contextWindow ?? 128000}
                  onChange={(e) => update('contextWindow', parseInt(e.target.value, 10) || 0)}
                />
                {errors.has('contextWindow') ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.get('contextWindow')}</p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.maxOutputTokens}</label>
                <input
                  type="number"
                  min={1}
                  className={cn(inputClassName(), errors.has('maxTokens') && 'border-red-500')}
                  value={form.maxTokens ?? 16384}
                  onChange={(e) => update('maxTokens', parseInt(e.target.value, 10) || 0)}
                />
                {errors.has('maxTokens') ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.get('maxTokens')}</p>
                ) : null}
              </div>
            </div>
            <div className="border-t border-edge-subtle pt-2 dark:border-edge">
              <p className="mb-2 text-xs font-semibold text-fg">{m.costSection}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-fg-muted">{m.costInput}</label>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    className={inputClassName()}
                    value={form.cost?.input ?? 0}
                    onChange={(e) =>
                      update('cost', {
                        ...form.cost,
                        input: parseFloat(e.target.value) || 0,
                        output: form.cost?.output ?? 0,
                        cacheRead: form.cost?.cacheRead ?? 0,
                        cacheWrite: form.cost?.cacheWrite ?? 0,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-fg-muted">{m.costOutput}</label>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    className={inputClassName()}
                    value={form.cost?.output ?? 0}
                    onChange={(e) =>
                      update('cost', {
                        ...form.cost,
                        input: form.cost?.input ?? 0,
                        output: parseFloat(e.target.value) || 0,
                        cacheRead: form.cost?.cacheRead ?? 0,
                        cacheWrite: form.cost?.cacheWrite ?? 0,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-edge-subtle pt-3 dark:border-edge">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                {m.cancel}
              </Button>
            </Dialog.Close>
            <Button type="button" className="bg-accent text-white hover:bg-accent/90" onClick={handleSave}>
              {isNew ? m.addModelConfirm : m.saveModelConfirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
  const [testResults, setTestResults] = useState<Map<string, { type: string; resolved?: string; error?: string }>>(
    () => new Map(),
  );

  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerPreset, setProviderPreset] = useState<string | null>(null);

  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelDialogCtx, setModelDialogCtx] = useState<{
    providerId: string;
    model: CustomModel | null;
    isNew: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
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
      await load();
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
          href={DOCS_URL}
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
        <Button type="button" variant="secondary" onClick={runValidate} disabled={loading || validating}>
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
        <Button type="button" variant="secondary" onClick={runReload} disabled={loading || reloading}>
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
        <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-edge-subtle bg-surface-panel px-6 py-12 text-center dark:border-edge">
          <div className="mb-4 flex size-14 items-center justify-center rounded-full border border-edge bg-surface-base dark:border-edge">
            <Cpu className="size-7 text-accent" strokeWidth={1.5} />
          </div>
          <h2 className="mb-1 text-base font-semibold text-fg">{ms.emptyTitle}</h2>
          <p className="mb-6 max-w-md text-sm text-fg-muted">{ms.emptyDesc}</p>
          <Button
            type="button"
            className="mb-6 bg-accent text-white hover:bg-accent/90"
            onClick={() => openAddProvider(null)}
          >
            <Plus className="mr-1 size-4" />
            {ms.emptyCta}
          </Button>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg transition hover:border-accent hover:text-accent dark:border-edge"
              onClick={() => openAddProvider('ollama')}
            >
              <Zap className="size-3.5" />
              {ms.presetOllama}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg transition hover:border-accent hover:text-accent dark:border-edge"
              onClick={() => openAddProvider('openrouter')}
            >
              <Box className="size-3.5" />
              {ms.presetOpenRouter}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg transition hover:border-accent hover:text-accent dark:border-edge"
              onClick={() => openAddProvider('lmstudio')}
            >
              <Cpu className="size-3.5" />
              {ms.presetLmStudio}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(config.providers)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, prov]) => {
              const isEx = expanded.has(id);
              const nModels = prov.models?.length ?? 0;
              const keyType = prov.apiKey ? getApiKeyType(prov.apiKey) : null;
              const testResult = testResults.get(id);
              const pwVisible = showPw.has(id);

              return (
                <section
                  key={id}
                  className="overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-sm dark:border-edge dark:shadow-none"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-edge-subtle bg-surface-base/60 px-3 py-2 dark:border-edge">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      onClick={() => toggleExpand(id)}
                    >
                      {isEx ? (
                        <ChevronDown className="size-4 shrink-0 text-fg-muted" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-fg-muted" />
                      )}
                      <span className="truncate">{id}</span>
                      {nModels > 0 ? (
                        <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                          {nModels}
                        </span>
                      ) : null}
                      {keyType ? (
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                            keyType === 'shell' && 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
                            keyType === 'env' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
                            keyType === 'literal' && 'bg-surface-hover text-fg-muted dark:bg-surface-active',
                          )}
                        >
                          {keyType === 'shell' ? ms.badgeShell : keyType === 'env' ? ms.badgeEnv : ms.badgeLiteral}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:text-red-400"
                      onClick={() => removeProv(id)}
                      aria-label={ms.removeProvider}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  {isEx ? (
                    <div className="space-y-4 px-3 py-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-muted">{ms.baseUrl}</label>
                          <input
                            className={inputClassName()}
                            value={prov.baseUrl || ''}
                            onChange={(e) =>
                              setConfig((c) => updateProvider(c, id, { baseUrl: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-muted">{ms.apiType}</label>
                          <select
                            className={selectClassName()}
                            value={prov.api || 'openai-completions'}
                            onChange={(e) =>
                              setConfig((c) =>
                                updateProvider(c, id, { api: e.target.value as ApiType }),
                              )
                            }
                          >
                            {API_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-muted">{ms.apiKey}</label>
                        <div className="flex flex-wrap gap-2">
                          <input
                            className={cn(inputClassName(), 'min-w-0 flex-1')}
                            type={pwVisible ? 'text' : 'password'}
                            autoComplete="off"
                            value={prov.apiKey || ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setConfig((c) => updateProvider(c, id, { apiKey: v }));
                              setTestResults((prev) => {
                                const next = new Map(prev);
                                next.delete(id);
                                return next;
                              });
                            }}
                            placeholder={ms.apiKeyPlaceholder}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            className="px-2 py-1 text-xs"
                            onClick={() => toggleShowPw(id)}
                          >
                            {pwVisible ? (
                              <>
                                <EyeOff className="mr-1 size-3.5" />
                                {ms.hide}
                              </>
                            ) : (
                              <>
                                <Eye className="mr-1 size-3.5" />
                                {ms.show}
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="px-2 py-1 text-xs"
                            onClick={() => runTestKey(id, prov.apiKey || '')}
                          >
                            {ms.testKey}
                          </Button>
                        </div>
                        {testResult ? (
                          <p
                            className={cn(
                              'mt-1 text-xs',
                              testResult.error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400',
                            )}
                          >
                            {testResult.error
                              ? `${ms.testError}: ${testResult.error}`
                              : `${ms.testOk} (${testResult.type}): ${maskApiKey(testResult.resolved || '')}`}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-fg-subtle">{ms.apiKeyHint}</p>
                      </div>

                      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-edge text-accent focus:ring-accent/30"
                          checked={prov.authHeader || false}
                          onChange={(e) =>
                            setConfig((c) => updateProvider(c, id, { authHeader: e.target.checked }))
                          }
                        />
                        {ms.authHeader}
                      </label>

                      <div className="border-t border-edge-subtle pt-3 dark:border-edge">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-fg">{ms.modelsSection}</span>
                          <Button
                            type="button"
                            variant="primary"
                            className="px-2 py-1 text-xs"
                            onClick={() => openModelDialog(id, null, true)}
                          >
                            <Plus className="mr-1 size-3.5" />
                            {ms.addModel}
                          </Button>
                        </div>
                        {(prov.models || []).length === 0 ? (
                          <p className="text-xs text-fg-muted">{ms.modelsEmpty}</p>
                        ) : (
                          <ul className="space-y-2">
                            {(prov.models || []).map((mod) => (
                              <li
                                key={mod.id}
                                className="flex items-center justify-between gap-2 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 dark:border-edge"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-fg">{mod.id}</div>
                                  {mod.name && mod.name !== mod.id ? (
                                    <div className="truncate text-xs text-fg-muted">{mod.name}</div>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 gap-1">
                                  <button
                                    type="button"
                                    className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-panel hover:text-fg"
                                    onClick={() => openModelDialog(id, mod, false)}
                                    aria-label={ms.editModel}
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-panel hover:text-red-600 dark:hover:text-red-400"
                                    onClick={() => {
                                      if (!window.confirm(ms.removeModelConfirm.replace('{{id}}', mod.id))) return;
                                      setConfig((c) => {
                                        const p = c.providers[id];
                                        if (!p) return c;
                                        return updateProvider(c, id, {
                                          models: (p.models || []).filter((mm) => mm.id !== mod.id),
                                        });
                                      });
                                    }}
                                    aria-label={ms.removeModel}
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
        </div>
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
