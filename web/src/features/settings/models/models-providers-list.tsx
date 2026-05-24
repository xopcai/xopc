import {
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { type ModelsSettingsMessages } from '@/i18n/messages';

import {
  API_TYPE_OPTIONS,
  getApiKeyType,
  maskApiKey,
  type ApiType,
  type CustomModel,
  type ModelsJsonConfig,
} from '../models-json-api';

import { inputClassName, selectClassName, updateProvider } from './models-settings-lib';

export type ModelsTestResult = { type: string; resolved?: string; error?: string };

type ModelsProvidersListProps = {
  config: ModelsJsonConfig;
  setConfig: Dispatch<SetStateAction<ModelsJsonConfig>>;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  showPw: Set<string>;
  toggleShowPw: (id: string) => void;
  testResults: Map<string, ModelsTestResult>;
  runTestKey: (providerId: string, value: string) => void;
  ms: ModelsSettingsMessages;
  removeProv: (providerId: string) => void;
  openModelDialog: (providerId: string, model: CustomModel | null, isNew: boolean) => void;
  setTestResults: Dispatch<SetStateAction<Map<string, ModelsTestResult>>>;
};

export function ModelsProvidersList({
  config,
  setConfig,
  expanded,
  toggleExpand,
  showPw,
  toggleShowPw,
  testResults,
  runTestKey,
  ms,
  removeProv,
  openModelDialog,
  setTestResults,
}: ModelsProvidersListProps) {
  return (
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
              className="overflow-hidden rounded-2xl bg-surface-base"
            >
              <div className="flex items-center justify-between gap-2 border-b border-edge-subtle bg-surface-hover/35 px-3 py-2 dark:border-edge-subtle">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 transition-transform duration-150 ease-out active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
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
                  className={cn(
                    'rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:text-red-400',
                    interaction.press,
                  )}
                  onClick={() => removeProv(id)}
                  aria-label={ms.removeProvider}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              {isEx ? (
                <div className="space-y-4 p-3">
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
                      className="ui-checkbox"
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
                                className={cn(
                                  'rounded-lg p-1.5 text-fg-muted hover:bg-surface-panel hover:text-fg',
                                  interaction.press,
                                )}
                                onClick={() => openModelDialog(id, mod, false)}
                                aria-label={ms.editModel}
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  'rounded-lg p-1.5 text-fg-muted hover:bg-surface-panel hover:text-red-600 dark:hover:text-red-400',
                                  interaction.press,
                                )}
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
  );
}

type ModelsSettingsEmptyStateProps = {
  ms: ModelsSettingsMessages;
  openAddProvider: (preset: string | null) => void;
};

export function ModelsSettingsEmptyState({ ms, openAddProvider }: ModelsSettingsEmptyStateProps) {
  return (
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
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg hover:border-accent hover:text-accent dark:border-edge',
            interaction.transition,
            interaction.focusRingBase,
            interaction.press,
          )}
          onClick={() => openAddProvider('ollama')}
        >
          <Zap className="size-3.5" aria-hidden />
          {ms.presetOllama}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg hover:border-accent hover:text-accent dark:border-edge',
            interaction.transition,
            interaction.focusRingBase,
            interaction.press,
          )}
          onClick={() => openAddProvider('openrouter')}
        >
          <Box className="size-3.5" aria-hidden />
          {ms.presetOpenRouter}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg hover:border-accent hover:text-accent dark:border-edge',
            interaction.transition,
            interaction.focusRingBase,
            interaction.press,
          )}
          onClick={() => openAddProvider('lmstudio')}
        >
          <Cpu className="size-3.5" aria-hidden />
          {ms.presetLmStudio}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg hover:border-accent hover:text-accent dark:border-edge',
            interaction.transition,
            interaction.focusRingBase,
            interaction.press,
          )}
          onClick={() => openAddProvider('zhipuCn')}
        >
          <Zap className="size-3.5" aria-hidden />
          {ms.presetZhipuCn}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg hover:border-accent hover:text-accent dark:border-edge',
            interaction.transition,
            interaction.focusRingBase,
            interaction.press,
          )}
          onClick={() => openAddProvider('zaiGeneral')}
        >
          <Box className="size-3.5" aria-hidden />
          {ms.presetZaiGeneral}
        </button>
      </div>
    </div>
  );
}
