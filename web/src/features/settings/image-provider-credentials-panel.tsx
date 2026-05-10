import { ExternalLink, Loader2, Save } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ImageProviderApiKeyField } from '@/features/settings/image-provider-api-key-field';
import { emptyImageProviderCredRow, type ImageProviderCredRow } from '@/features/settings/image-providers-config-api';
import { getOrderedApiKeyLinks } from '@/features/settings/provider-enrichment';
import type {
  ImageGenProviderCredentialSummary,
  ImageProviderUiMetadata,
} from '@/features/settings/use-image-provider-credentials';
import type { ProvidersSettingsMessages } from '@/i18n/messages';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import type { StoredLanguage } from '@/lib/storage';
import { cn } from '@/lib/cn';

function inputClass(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
}

function selectClass(): string {
  return cn(inputClass(), 'appearance-none bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat pr-9');
}

const CUSTOM_SENTINEL = '__custom__';

function dashscopeSelectValue(
  row: ImageProviderCredRow,
  regions: NonNullable<ImageProviderUiMetadata['regions']>,
): string {
  if (!row.region.trim() && !row.imageBaseUrl.trim()) return '';
  const r = row.region.trim().toLowerCase();
  if (regions.some((x) => x.value === r)) return r;
  return CUSTOM_SENTINEL;
}

function baseUrlSelectValue(
  row: ImageProviderCredRow,
  presets: NonNullable<ImageProviderUiMetadata['baseUrlPresets']>,
): string {
  const b = row.baseUrl.trim().replace(/\/+$/, '');
  if (!b) return '';
  const norm = presets.map((p) => p.value.replace(/\/+$/, ''));
  const idx = norm.indexOf(b);
  if (idx >= 0) return presets[idx].value;
  return CUSTOM_SENTINEL;
}

export type ImageProviderCredentialsPanelMessages = {
  credentialsIntro: string;
  regionHint: string;
  endpointPresetsHint: string;
  apiKeyLabel: string;
  optionalPlaceholder: string;
  regionLabel: string;
  baseUrlLabel: string;
  imageBaseUrlLabel: string;
  saveCredentials: string;
  savingCredentials: string;
  credentialsSaved: string;
  discardCredentials: string;
  credentialsNothingToSave: string;
  credentialsSaveError: string;
  regionPresetDefault: string;
  regionPresetCustom: string;
  baseUrlPresetDefault: string;
  baseUrlPresetCustom: string;
  openExtensionSettings: string;
  openImageModelsPage: string;
  extensionSettingsLinkTitle: string;
  imageModelsLinkTitle: string;
  configured: string;
  missingKey: string;
  defaultModel: string;
  modelsLabel: string;
  imageBaseUrlPresetHint: string;
  dashscopeRegion_beijing: string;
  dashscopeRegion_singapore: string;
  dashscopeRegion_us: string;
  apiKeyMaskedHelp: string;
  apiKeyCopy: string;
  apiKeyCopied: string;
  apiKeyShow: string;
  apiKeyHide: string;
  apiKeyNotInConfigFile: string;
  apiKeyRevealFailed: string;
  minimaxClusterLabel: string;
  minimaxClusterHint: string;
  falQueueBaseLabel: string;
  falQueueBaseHint: string;
};

function translateDashscopeRegion(m: ImageProviderCredentialsPanelMessages, value: string, serverLabel: string) {
  if (value === 'beijing') return m.dashscopeRegion_beijing;
  if (value === 'singapore') return m.dashscopeRegion_singapore;
  if (value === 'us') return m.dashscopeRegion_us;
  return serverLabel;
}

function baseUrlPresetBlockTitle(
  t: ImageProviderCredentialsPanelMessages,
  kind: ImageProviderUiMetadata['baseUrlPresetKind'],
): string {
  if (kind === 'minimax') return t.minimaxClusterLabel;
  if (kind === 'fal') return t.falQueueBaseLabel;
  return t.baseUrlLabel;
}

function baseUrlPresetBlockHint(
  t: ImageProviderCredentialsPanelMessages,
  kind: ImageProviderUiMetadata['baseUrlPresetKind'],
): string | null {
  if (kind === 'minimax') return t.minimaxClusterHint;
  if (kind === 'fal') return t.falQueueBaseHint;
  return null;
}

export function ImageProviderCredentialsPanel({
  summaries,
  credDraft,
  credDirty,
  credSaving,
  credError,
  credSavedFlash,
  credNoopFlash,
  updateCredRow,
  onDiscardCredentials,
  onSaveCredentials,
  extensionIds,
  showExtensionLinks,
  showImageModelsLink,
  language,
  apiKeyLinkLabels,
  messages: t,
}: {
  summaries: ImageGenProviderCredentialSummary[];
  credDraft: Record<string, ImageProviderCredRow>;
  credDirty: boolean;
  credSaving: boolean;
  credError: string | null;
  credSavedFlash: boolean;
  credNoopFlash: boolean;
  updateCredRow: (id: string, patch: Partial<ImageProviderCredRow>) => void;
  onDiscardCredentials: () => void;
  onSaveCredentials: () => void;
  /** Extension ids present in gateway discovery (for deep links). */
  extensionIds: Set<string>;
  showExtensionLinks: boolean;
  showImageModelsLink: boolean;
  language: StoredLanguage;
  apiKeyLinkLabels: Pick<ProvidersSettingsMessages, 'getApiKey' | 'getApiKeyIntl' | 'getApiKeyCn'>;
  messages: ImageProviderCredentialsPanelMessages;
}) {
  const empty = summaries.length === 0;

  if (empty) {
    return null;
  }

  const anyRegionUi = summaries.some((s) => (s.ui?.regions?.length ?? 0) > 0);
  const anyBaseUrlPresets = summaries.some((s) => (s.ui?.baseUrlPresets?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-xs leading-relaxed text-fg-muted">
        <p>{t.credentialsIntro}</p>
        {anyRegionUi ? <p className="text-fg-subtle">{t.regionHint}</p> : null}
        {anyBaseUrlPresets ? <p className="text-fg-subtle">{t.endpointPresetsHint}</p> : null}
        {showImageModelsLink ? (
          <p>
            <Link
              to="/settings/image-models"
              className="font-medium text-accent hover:underline"
              title={t.imageModelsLinkTitle}
            >
              {t.openImageModelsPage}
            </Link>
          </p>
        ) : null}
      </div>
      {credError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {credError}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {credSavedFlash ? (
          <span className="text-sm text-fg-muted">{t.credentialsSaved}</span>
        ) : null}
        {credNoopFlash ? (
          <span className="text-sm text-fg-muted">{t.credentialsNothingToSave}</span>
        ) : null}
        <Button type="button" variant="secondary" onClick={onDiscardCredentials} disabled={!credDirty || credSaving}>
          {t.discardCredentials}
        </Button>
        <Button type="button" variant="primary" onClick={onSaveCredentials} disabled={!credDirty || credSaving}>
          {credSaving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span className="ml-1.5">{t.savingCredentials}</span>
            </>
          ) : (
            <>
              <Save className="size-3.5" />
              <span className="ml-1.5">{t.saveCredentials}</span>
            </>
          )}
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        {summaries.map((p) => {
          const row = credDraft[p.id] ?? emptyImageProviderCredRow();
          const ui = p.ui;
          const extPath =
            showExtensionLinks && extensionIds.has(p.id)
              ? `/settings/ext/${encodeURIComponent(p.id)}`
              : null;
          return (
            <div
              key={p.id}
              className="rounded-lg border border-edge bg-surface-panel px-4 py-3 shadow-sm dark:shadow-none"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg">{p.label ?? p.id}</span>
                  <span className="text-xs text-fg-subtle">({p.id})</span>
                  {extPath ? (
                    <Link
                      to={extPath}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      title={t.extensionSettingsLinkTitle}
                    >
                      <ExternalLink className="size-3" />
                      {t.openExtensionSettings}
                    </Link>
                  ) : null}
                </div>
                {p.configured ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-fg">
                    {t.configured}
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    {t.missingKey}
                  </span>
                )}
              </div>
              {p.defaultModel ? (
                <p className="mt-1 text-xs text-fg-subtle">
                  <span className="text-fg-muted">{t.defaultModel}:</span> {p.id}/{p.defaultModel}
                </p>
              ) : null}
              {p.models.length > 0 ? (
                <p className="mt-0.5 text-xs text-fg-subtle">
                  <span className="text-fg-muted">{t.modelsLabel}:</span>{' '}
                  {p.models.map((mm) => `${p.id}/${mm}`).join(', ')}
                </p>
              ) : null}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ImageProviderApiKeyField
                  providerId={p.id}
                  value={row.apiKey}
                  onChange={(next) => updateCredRow(p.id, { apiKey: next })}
                  apiKeyLinks={getOrderedApiKeyLinks(p.id, language)}
                  apiKeyLinkLabels={apiKeyLinkLabels}
                  labels={{
                    apiKeyLabel: t.apiKeyLabel,
                    optionalPlaceholder: t.optionalPlaceholder,
                    maskedHelp: t.apiKeyMaskedHelp,
                    copy: t.apiKeyCopy,
                    copied: t.apiKeyCopied,
                    show: t.apiKeyShow,
                    hide: t.apiKeyHide,
                    notInConfigFile: t.apiKeyNotInConfigFile,
                    loadFailed: t.apiKeyRevealFailed,
                  }}
                />

                {ui?.regions?.length ? (
                  <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
                    <label className="text-xs font-medium text-fg-muted" htmlFor={`img-cred-region-preset-${p.id}`}>
                      {t.regionLabel}
                    </label>
                    <select
                      id={`img-cred-region-preset-${p.id}`}
                      className={selectClass()}
                      value={dashscopeSelectValue(row, ui.regions)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') {
                          updateCredRow(p.id, { region: '', imageBaseUrl: '' });
                          return;
                        }
                        if (v === CUSTOM_SENTINEL) {
                          updateCredRow(p.id, { region: '', imageBaseUrl: '' });
                          return;
                        }
                        const opt = ui.regions!.find((x) => x.value === v);
                        if (opt) {
                          updateCredRow(p.id, { region: opt.value, imageBaseUrl: opt.imageBaseUrl });
                        }
                      }}
                    >
                      <option value="">{t.regionPresetDefault}</option>
                      {ui.regions.map((r) => (
                        <option key={r.value} value={r.value}>
                          {translateDashscopeRegion(t, r.value, r.label)}
                        </option>
                      ))}
                      <option value={CUSTOM_SENTINEL}>{t.regionPresetCustom}</option>
                    </select>
                    {dashscopeSelectValue(row, ui.regions) === CUSTOM_SENTINEL ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          className={inputClass()}
                          value={row.region}
                          placeholder="region"
                          onChange={(e) => updateCredRow(p.id, { region: e.target.value })}
                        />
                        <input
                          type="url"
                          className={inputClass()}
                          value={row.imageBaseUrl}
                          placeholder={t.imageBaseUrlLabel}
                          onChange={(e) => updateCredRow(p.id, { imageBaseUrl: e.target.value })}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {ui?.baseUrlPresets?.length ? (
                  <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
                    <label className="text-xs font-medium text-fg-muted" htmlFor={`img-cred-base-preset-${p.id}`}>
                      {baseUrlPresetBlockTitle(t, ui.baseUrlPresetKind)}
                    </label>
                    {baseUrlPresetBlockHint(t, ui.baseUrlPresetKind) ? (
                      <p className="text-[11px] text-fg-subtle">{baseUrlPresetBlockHint(t, ui.baseUrlPresetKind)}</p>
                    ) : null}
                    <select
                      id={`img-cred-base-preset-${p.id}`}
                      className={selectClass()}
                      value={baseUrlSelectValue(row, ui.baseUrlPresets)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') {
                          updateCredRow(p.id, { baseUrl: '' });
                          return;
                        }
                        if (v === CUSTOM_SENTINEL) {
                          updateCredRow(p.id, { baseUrl: '' });
                          return;
                        }
                        updateCredRow(p.id, { baseUrl: v.replace(/\/+$/, '') });
                      }}
                    >
                      <option value="">{t.baseUrlPresetDefault}</option>
                      {ui.baseUrlPresets.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                      <option value={CUSTOM_SENTINEL}>{t.baseUrlPresetCustom}</option>
                    </select>
                    {baseUrlSelectValue(row, ui.baseUrlPresets) === CUSTOM_SENTINEL ? (
                      <input
                        type="url"
                        className={cn(inputClass(), 'mt-2')}
                        value={row.baseUrl}
                        placeholder="https://…"
                        onChange={(e) => updateCredRow(p.id, { baseUrl: e.target.value })}
                      />
                    ) : null}
                  </div>
                ) : null}

                {ui?.regions?.length && dashscopeSelectValue(row, ui.regions) !== CUSTOM_SENTINEL ? (
                  <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
                    <label className="text-xs font-medium text-fg-muted" htmlFor={`img-cred-imgbase-ro-${p.id}`}>
                      {t.imageBaseUrlLabel}
                    </label>
                    <input
                      id={`img-cred-imgbase-ro-${p.id}`}
                      type="url"
                      readOnly
                      className={cn(inputClass(), 'cursor-not-allowed opacity-90')}
                      value={row.imageBaseUrl}
                      title={t.imageBaseUrlPresetHint}
                    />
                    <p className="text-[11px] text-fg-subtle">{t.imageBaseUrlPresetHint}</p>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
