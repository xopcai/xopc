import * as Dialog from '@radix-ui/react-dialog';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { ProviderApiKeyField } from '@/features/settings/provider-api-key-field';
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
  type ModelsJsonConfig,
  type ProviderConfig,
} from '@/features/settings/models-json-api';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';

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

  const apiKeyLinks = useMemo(
    () => getOrderedApiKeyLinks(providerId, language),
    [providerId, language],
  );

  const dirty = apiKey !== (row?.apiKey ?? '');

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed || isMaskedKey(trimmed)) return;
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

  const handleRemove = async () => {
    try {
      await deleteProviderApiKey(providerId);
      onSaved();
      onClose();
    } catch {
      // silent — not critical
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

        {row?.supportsApiKey !== false ? (
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
        ) : (
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
        )}

        {apiKeyLinks.length > 0 ? (
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
        {row?.supportsApiKey !== false ? (
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
          {dirty && !isMaskedKey(apiKey.trim()) ? (
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
  onClose,
  onSaved,
}: {
  providerId: string;
  customConfig: ModelsJsonConfig | null;
  labels: ProviderManageDialogMessages;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existingProvider = customConfig?.providers[providerId];
  const [baseUrl, setBaseUrl] = useState(existingProvider?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(existingProvider?.apiKey ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const modelCount = existingProvider?.models?.length ?? 0;

  const handleSave = async () => {
    if (!customConfig) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedKey = apiKey.trim();
      const updatedProvider: ProviderConfig = {
        ...existingProvider,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: isMaskedKey(trimmedKey)
          ? existingProvider?.apiKey
          : trimmedKey || undefined,
      };
      const updatedConfig: ModelsJsonConfig = {
        providers: {
          ...customConfig.providers,
          [providerId]: updatedProvider,
        },
      };
      await saveModelsJson(updatedConfig);
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

        {/* Model count */}
        <div className="text-sm text-fg-muted">
          {modelCount > 0
            ? labels.modelsCount.replace('{{count}}', String(modelCount))
            : labels.noModels}
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
    </>
  );
}
