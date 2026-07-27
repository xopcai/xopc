import * as Dialog from '@radix-ui/react-dialog';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogIn,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { ModelEditDialogContent } from '@/features/settings/models/models-model-edit-dialog';
import { ProviderApiKeyField } from '@/features/settings/provider-api-key-field';
import {
  cancelOAuth,
  cleanupOAuthSession,
  fetchOAuthSessionStatus,
  revokeOAuth,
  startAsyncOAuthLogin,
  submitOAuthCode,
} from '@/features/settings/oauth-api';
import {
  deleteProviderApiKey,
  isMaskedKey,
  patchProviderApiKeys,
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import {
  getOrderedApiKeyLinks,
  PROVIDER_ENRICHMENT,
  providerApiKeyLinkLabel,
} from '@/features/settings/provider-enrichment';
import {
  saveModelsJson,
  type CustomModel,
  type ModelsJsonConfig,
  type ProviderConfig,
} from '@/features/settings/models-json-api';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';
import { messages } from '@/i18n/messages';

export interface ProviderManageDialogMessages {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiUrlLabel: string;
  apiUrlExtensionHint: string;
  baseUrlLabel: string;
  modelsLabel: string;
  noModels: string;
  modelsCount: string;
  save: string;
  saving: string;
  saved: string;
  cancel: string;
  close: string;
  remove: string;
  removeConfirmTitle: string;
  removeConfirmDescription: string;
  removeConfirmAction: string;
  saveError: string;
  getApiKey: string;
  getApiKeyIntl: string;
  getApiKeyCn: string;
  showKey: string;
  hideKey: string;
  copy: string;
  copied: string;
  maskedHelp: string;
  notInConfigFile: string;
  extensionKeyHint: string;
  openExtensionSettings: string;
  extensionSettingsLinkTitle: string;
  loadFailed: string;
  custom: string;
}

interface ProviderManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  isCustom: boolean;
  builtinRows: ProviderRowModel[];
  customConfig: ModelsJsonConfig | null;
  allModels: ConfiguredModel[];
  labels: ProviderManageDialogMessages;
  language: StoredLanguage;
  onSaved: () => void;
}

export function ProviderManageDialog({
  open,
  onOpenChange,
  providerId,
  isCustom,
  builtinRows,
  customConfig,
  allModels,
  labels,
  language,
  onSaved,
}: ProviderManageDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]',
            SETTINGS_SHELL_OVERLAY_Z,
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base shadow-xl',
            SETTINGS_SHELL_CONTENT_Z,
          )}
        >
          {isCustom ? (
            <ManageCustomProvider
              providerId={providerId}
              customConfig={customConfig}
              labels={labels}
              language={language}
              onClose={() => onOpenChange(false)}
              onSaved={onSaved}
            />
          ) : (
            <ManageBuiltinProvider
              providerId={providerId}
              builtinRows={builtinRows}
              allModels={allModels}
              labels={labels}
              language={language}
              onClose={() => onOpenChange(false)}
              onSaved={onSaved}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Built-in provider management ── */

function ManageBuiltinProvider({
  providerId,
  builtinRows,
  allModels,
  labels,
  language,
  onClose,
  onSaved,
}: {
  providerId: string;
  builtinRows: ProviderRowModel[];
  allModels: ConfiguredModel[];
  labels: ProviderManageDialogMessages;
  language: StoredLanguage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = builtinRows.find((r) => r.id === providerId);
  const enrichment = PROVIDER_ENRICHMENT[providerId];
  const providerModels = allModels.filter((m) => m.provider === providerId);

  const [apiKey, setApiKey] = useState(row?.apiKey ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const providerLabels = messages(language).providersSettings;
  const supportsApiKey = row?.supportsApiKey !== false;
  const supportsOAuth = row?.supportsOAuth === true;
  const isOAuthConnected = row?.authMode === 'oauth' && row.authStatus === 'connected';
  const canRemoveProviderCredential =
    row?.configured === true &&
    row.activeKeySource !== 'env' &&
    row.activeKeySource !== 'extension' &&
    row.activeKeySource !== 'models_json';

  const [oauthSessionId, setOAuthSessionId] = useState<string | null>(null);
  const [oauthMessage, setOAuthMessage] = useState<string | null>(null);
  const [oauthStatus, setOAuthStatus] = useState<'idle' | 'waiting' | 'waiting_code' | 'success' | 'error'>('idle');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const oauthLoading = oauthStatus === 'waiting' || oauthStatus === 'waiting_code';

  const apiKeyLinks = useMemo(
    () => getOrderedApiKeyLinks(providerId, language),
    [providerId, language],
  );

  const dirty = apiKey !== (row?.apiKey ?? '');

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed || !supportsApiKey || isMaskedKey(trimmed)) return;
    setSaving(true);
    setError(null);
    try {
      await patchProviderApiKeys({ [providerId]: trimmed });
      setSaved(true);
      window.setTimeout(() => {
        onSaved();
        onClose();
      }, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.saveError);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!oauthSessionId || !oauthLoading) return;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const status = await fetchOAuthSessionStatus(oauthSessionId);
          if (status.status === 'waiting_auth' || status.status === 'waiting_code') {
            setOAuthStatus(status.status === 'waiting_code' ? 'waiting_code' : 'waiting');
            setOAuthMessage(status.message ?? null);
            setAuthUrl(status.authUrl ?? null);
            setInstructions(status.instructions ?? null);
          } else if (status.status === 'completed') {
            window.clearInterval(intervalId);
            setOAuthStatus('success');
            setOAuthMessage(status.message ?? providerLabels.saved);
            window.setTimeout(() => {
              onSaved();
              onClose();
            }, 600);
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            window.clearInterval(intervalId);
            setOAuthStatus('error');
            setOAuthMessage(status.error ?? status.message ?? providerLabels.revokeFailed);
          }
        } catch {
          // Keep polling; transient gateway reloads should not kill the flow.
        }
      })();
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [oauthSessionId, oauthLoading, onClose, onSaved, providerLabels.revokeFailed, providerLabels.saved]);

  useEffect(() => {
    return () => {
      if (oauthSessionId) {
        void cleanupOAuthSession(oauthSessionId).catch(() => {});
      }
    };
  }, [oauthSessionId]);

  const handleRemove = async () => {
    try {
      await deleteProviderApiKey(providerId);
      onSaved();
      onClose();
    } catch {
      // silent — not critical
    }
  };

  const startOAuth = async () => {
    setOAuthStatus('waiting');
    setOAuthMessage(providerLabels.oauthStarting);
    setError(null);
    try {
      const result = await startAsyncOAuthLogin(providerId);
      setOAuthSessionId(result.sessionId);
    } catch (e) {
      setOAuthStatus('error');
      setOAuthMessage(e instanceof Error ? e.message : providerLabels.revokeFailed);
    }
  };

  const cancelFlow = async () => {
    if (!oauthSessionId) return;
    try {
      await cancelOAuth(oauthSessionId);
    } catch {
      // Best effort cancellation.
    }
    setOAuthStatus('idle');
    setOAuthMessage(null);
    setOAuthSessionId(null);
    setAuthUrl(null);
    setInstructions(null);
  };

  const submitCode = async () => {
    if (!oauthSessionId || !codeInput.trim()) return;
    try {
      await submitOAuthCode(oauthSessionId, codeInput.trim());
      setCodeInput('');
      setOAuthMessage(providerLabels.oauthProcessingCode);
    } catch (e) {
      setOAuthStatus('error');
      setOAuthMessage(e instanceof Error ? e.message : providerLabels.revokeFailed);
    }
  };

  const disconnectOAuth = async () => {
    try {
      await revokeOAuth(providerId);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : providerLabels.revokeFailed);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-edge-subtle px-5 py-4">
        <Dialog.Title className="text-base font-semibold text-fg">
          {row?.name ?? providerId}
        </Dialog.Title>
        <Dialog.Close asChild>
          <button
            type="button"
            className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.press)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </Dialog.Close>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        {enrichment?.description ? (
          <p className="text-sm text-fg-muted">{enrichment.description}</p>
        ) : null}

        {row?.baseUrl ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">{labels.apiUrlLabel}</span>
            <code className="break-all rounded-lg border border-edge-subtle bg-surface-panel/60 px-3 py-2 font-mono text-xs text-fg-muted">
              {row.baseUrl}
            </code>
          </div>
        ) : row?.category === 'extension' ? (
          <p className="text-sm text-fg-muted">{labels.apiUrlExtensionHint}</p>
        ) : null}

        {supportsApiKey ? (
          <ProviderApiKeyField
            providerId={providerId}
            inputId="manage-api-key"
            value={apiKey}
            onChange={(next) => {
              setApiKey(next);
              setSaved(false);
            }}
            labels={{
              apiKeyLabel: labels.apiKeyLabel,
              apiKeyPlaceholder: labels.apiKeyPlaceholder,
              maskedHelp: labels.maskedHelp,
              copy: labels.copy,
              copied: labels.copied,
              show: labels.showKey,
              hide: labels.hideKey,
              notInConfigFile: labels.notInConfigFile,
              loadFailed: labels.loadFailed,
            }}
          />
        ) : row?.category === 'extension' ? (
          <div className="flex flex-col gap-2 rounded-lg border border-edge-subtle bg-surface-panel/60 px-3 py-2 text-sm text-fg-muted">
            <p>{labels.extensionKeyHint}</p>
            {row?.extensionId ? (
              <Link
                to={`/settings/ext/${encodeURIComponent(row.extensionId)}`}
                className="inline-flex w-fit items-center gap-1 font-medium text-accent hover:underline"
                title={labels.extensionSettingsLinkTitle}
                onClick={onClose}
              >
                {labels.openExtensionSettings}
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null}

        {supportsOAuth ? (
          <div className="flex flex-col gap-2 rounded-lg border border-edge-subtle bg-surface-panel/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{providerLabels.oauth}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {isOAuthConnected ? providerLabels.sourceOauth : providerLabels.oauthHint}
                </p>
              </div>
              {isOAuthConnected ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-1.5 text-red-600 dark:text-red-400"
                  onClick={() => void disconnectOAuth()}
                >
                  {providerLabels.revoke}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  className="gap-1.5"
                  disabled={oauthLoading}
                  onClick={() => void startOAuth()}
                >
                  {oauthLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <LogIn className="size-3.5" aria-hidden />}
                  {providerLabels.oauth}
                </Button>
              )}
            </div>
            {oauthMessage ? (
              <p className={cn('text-xs', oauthStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-fg-muted')}>
                {oauthMessage}
              </p>
            ) : null}
            {(oauthStatus === 'waiting' || oauthStatus === 'waiting_code') ? (
              <div className="flex flex-wrap gap-2">
                {authUrl ? (
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    {providerLabels.openAuthPage}
                  </a>
                ) : null}
                <Button type="button" variant="secondary" onClick={() => void cancelFlow()}>
                  {providerLabels.cancelOAuth}
                </Button>
              </div>
            ) : null}
            {instructions ? <p className="text-xs text-fg-muted">{instructions}</p> : null}
            {oauthStatus === 'waiting_code' ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void submitCode()}
                  placeholder={providerLabels.pasteRedirectUrl}
                  className={cn(
                    'min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
                    settingsInputFocusClass,
                  )}
                />
                <Button type="button" variant="primary" onClick={() => void submitCode()}>
                  {providerLabels.submitCode}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {apiKeyLinks.length > 0 && supportsApiKey ? (
          <div className="flex flex-wrap gap-2">
            {apiKeyLinks.map(({ kind, href }) => (
              <a
                key={kind}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                {providerApiKeyLinkLabel(kind, labels)}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ))}
          </div>
        ) : null}

        {/* Models */}
        {providerModels.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">
              {labels.modelsLabel} ({providerModels.length})
            </span>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-edge-subtle bg-surface-panel/40 p-2">
              <div className="flex flex-wrap gap-1.5">
                {providerModels.map((model) => (
                  <span
                    key={model.id}
                    className="inline-block rounded-md bg-surface-hover px-2 py-1 text-xs text-fg-muted"
                  >
                    {model.id.includes('/') ? model.id.split('/').pop() : model.id}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">{labels.noModels}</p>
        )}

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-edge-subtle px-5 py-3">
        {canRemoveProviderCredential ? (
          <Button
            type="button"
            variant="ghost"
            className="gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {labels.remove}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {supportsApiKey && dirty && !isMaskedKey(apiKey.trim()) ? (
            <Button
              type="button"
              variant="primary"
              disabled={!apiKey.trim() || saving || saved}
              onClick={() => void handleSave()}
            >
              {saved ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  {labels.saved}
                </span>
              ) : saving ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {labels.saving}
                </span>
              ) : (
                labels.save
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={labels.removeConfirmTitle}
        description={labels.removeConfirmDescription.replace('{{provider}}', row?.name ?? providerId)}
        confirmLabel={labels.removeConfirmAction}
        cancelLabel={labels.cancel}
        destructive
        onConfirm={() => void handleRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}

/* ── Custom provider management ── */

function ManageCustomProvider({
  providerId,
  customConfig,
  labels,
  language,
  onClose,
  onSaved,
}: {
  providerId: string;
  customConfig: ModelsJsonConfig | null;
  labels: ProviderManageDialogMessages;
  language: StoredLanguage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ms = messages(language).modelsSettings;
  const existingProvider = customConfig?.providers[providerId];
  const [baseUrl, setBaseUrl] = useState(existingProvider?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(existingProvider?.apiKey ?? '');
  const [models, setModels] = useState<CustomModel[]>(existingProvider?.models ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmRemoveModel, setConfirmRemoveModel] = useState<string | null>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelDialogCtx, setModelDialogCtx] = useState<{ model: CustomModel | null; isNew: boolean } | null>(null);

  const buildUpdatedConfig = (providerPatch: Partial<ProviderConfig>): ModelsJsonConfig | null => {
    if (!customConfig) return null;
    const trimmedKey = apiKey.trim();
    const updatedProvider: ProviderConfig = {
      ...existingProvider,
      baseUrl: baseUrl.trim() || undefined,
      apiKey: isMaskedKey(trimmedKey) ? existingProvider?.apiKey : trimmedKey || undefined,
      ...providerPatch,
    };
    return {
      providers: {
        ...customConfig.providers,
        [providerId]: updatedProvider,
      },
    };
  };

  const handleSave = async () => {
    const config = buildUpdatedConfig({ models });
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await saveModelsJson(config);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.saveError);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!customConfig) return;
    try {
      const { [providerId]: _removed, ...rest } = customConfig.providers;
      await saveModelsJson({ providers: rest });
      onSaved();
      onClose();
    } catch {
      // silent
    }
  };

  const openModelDialog = (model: CustomModel | null, isNew: boolean) => {
    setModelDialogCtx({ model, isNew });
    setModelDialogOpen(true);
  };

  const handleModelSaved = async (updated: CustomModel) => {
    if (!modelDialogCtx) return;
    const nextModels = modelDialogCtx.isNew
      ? [...models, updated]
      : models.map((m) => (m.id === updated.id ? updated : m));
    setModels(nextModels);

    const config = buildUpdatedConfig({ models: nextModels });
    if (!config) return;
    try {
      await saveModelsJson(config);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.saveError);
    }
  };

  const handleModelRemove = async (modelId: string) => {
    const nextModels = models.filter((m) => m.id !== modelId);
    setModels(nextModels);
    setConfirmRemoveModel(null);

    const config = buildUpdatedConfig({ models: nextModels });
    if (!config) return;
    try {
      await saveModelsJson(config);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.saveError);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-edge-subtle px-5 py-4">
        <div className="flex items-center gap-2">
          <Dialog.Title className="text-base font-semibold text-fg">{providerId}</Dialog.Title>
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
            {labels.custom}
          </span>
        </div>
        <Dialog.Close asChild>
          <button
            type="button"
            className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.press)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </Dialog.Close>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        {/* Base URL */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="manage-base-url" className="text-sm font-medium text-fg">
            {labels.baseUrlLabel}
          </label>
          <input
            id="manage-base-url"
            type="url"
            autoComplete="off"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className={cn(
              'rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
          />
        </div>

        {/* API Key */}
        <ProviderApiKeyField
          providerId={providerId}
          inputId="manage-custom-api-key"
          value={apiKey}
          onChange={setApiKey}
          labels={{
            apiKeyLabel: labels.apiKeyLabel,
            apiKeyPlaceholder: labels.apiKeyPlaceholder,
            maskedHelp: labels.maskedHelp,
            copy: labels.copy,
            copied: labels.copied,
            show: labels.showKey,
            hide: labels.hideKey,
            notInConfigFile: labels.notInConfigFile,
            loadFailed: labels.loadFailed,
          }}
        />

        {/* Models */}
        <div className="border-t border-edge-subtle pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-fg">
              {ms.modelsSection}{models.length > 0 ? ` (${models.length})` : ''}
            </span>
            <Button
              type="button"
              variant="primary"
              className="gap-1.5 px-2 py-1 text-xs"
              onClick={() => openModelDialog(null, true)}
            >
              <Plus className="size-3.5" aria-hidden />
              {ms.addModel}
            </Button>
          </div>
          {models.length === 0 ? (
            <p className="text-xs text-fg-muted">{ms.modelsEmpty}</p>
          ) : (
            <ul className="space-y-2">
              {models.map((mod) => (
                <li
                  key={mod.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-edge-subtle bg-surface-panel/40 px-3 py-2"
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
                        'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg',
                        interaction.press,
                      )}
                      onClick={() => openModelDialog(mod, false)}
                      aria-label={ms.editModel}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-red-600 dark:hover:text-red-400',
                        interaction.press,
                      )}
                      onClick={() => setConfirmRemoveModel(mod.id)}
                      aria-label={ms.removeModel}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-edge-subtle px-5 py-3">
        <Button
          type="button"
          variant="ghost"
          className="gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          onClick={() => setConfirmRemove(true)}
        >
          <Trash2 className="size-3.5" aria-hidden />
          {labels.remove}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {labels.saving}
              </span>
            ) : (
              labels.save
            )}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={labels.removeConfirmTitle}
        description={labels.removeConfirmDescription.replace('{{provider}}', providerId)}
        confirmLabel={labels.removeConfirmAction}
        cancelLabel={labels.cancel}
        destructive
        onConfirm={() => void handleRemove()}
        onCancel={() => setConfirmRemove(false)}
      />

      <ConfirmDialog
        open={confirmRemoveModel !== null}
        title={ms.removeModel}
        description={ms.removeModelConfirm.replace('{{id}}', confirmRemoveModel ?? '')}
        confirmLabel={labels.removeConfirmAction}
        cancelLabel={labels.cancel}
        destructive
        onConfirm={() => { if (confirmRemoveModel) void handleModelRemove(confirmRemoveModel); }}
        onCancel={() => setConfirmRemoveModel(null)}
      />

      <ModelEditDialogContent
        open={modelDialogOpen}
        onOpenChange={(o) => {
          setModelDialogOpen(o);
          if (!o) setModelDialogCtx(null);
        }}
        providerId={providerId}
        model={modelDialogCtx?.model ?? null}
        isNew={modelDialogCtx?.isNew ?? false}
        onSave={(m) => void handleModelSaved(m)}
        m={ms}
      />
    </>
  );
}
