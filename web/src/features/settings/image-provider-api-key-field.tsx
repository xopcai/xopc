import { CheckCircle2, Copy, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { revealImageProviderConfigApiKey } from '@/features/settings/image-providers-config-api';
import type { ApiKeyLinkKind } from '@/features/settings/provider-enrichment';
import { providerApiKeyLinkLabel } from '@/features/settings/provider-enrichment';
import { isMaskedKey } from '@/features/settings/providers-api';
import type { ProvidersSettingsMessages } from '@/i18n/messages';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

export type ImageProviderApiKeyFieldLabels = {
  apiKeyLabel: string;
  optionalPlaceholder: string;
  maskedHelp: string;
  copy: string;
  copied: string;
  show: string;
  hide: string;
  notInConfigFile: string;
  loadFailed: string;
};

export function ImageProviderApiKeyField({
  providerId,
  value,
  onChange,
  labels,
  apiKeyLinks,
  apiKeyLinkLabels,
}: {
  providerId: string;
  value: string;
  onChange: (next: string) => void;
  labels: ImageProviderApiKeyFieldLabels;
  apiKeyLinks: { href: string; kind: ApiKeyLinkKind }[];
  apiKeyLinkLabels: Pick<ProvidersSettingsMessages, 'getApiKey' | 'getApiKeyIntl' | 'getApiKeyCn'>;
}) {
  const [showKey, setShowKey] = useState(false);
  /** `undefined` = not fetched; `null` = fetched, not in config file; string = plaintext from config */
  const [revealed, setRevealed] = useState<string | null | undefined>(undefined);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const masked = isMaskedKey(value);

  useEffect(() => {
    if (!masked) {
      setRevealed(undefined);
      setRevealErr(null);
    }
  }, [masked, value]);

  const inputValue = (() => {
    if (!masked) return value;
    if (showKey && typeof revealed === 'string') return revealed;
    return value;
  })();

  const inputType =
    !masked || (masked && showKey && typeof revealed === 'string') ? ('text' as const) : ('password' as const);

  const copyEnabled =
    (!masked && value.trim().length > 0 && !isMaskedKey(value)) ||
    (Boolean(showKey) && typeof revealed === 'string' && revealed.length > 0);

  const copyKey = useCallback(async () => {
    const text =
      !masked && value.trim() && !isMaskedKey(value)
        ? value.trim()
        : typeof revealed === 'string' && revealed.length > 0
          ? revealed
          : '';
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [masked, revealed, value]);

  const toggleEye = useCallback(async () => {
    setRevealErr(null);
    if (!masked) {
      setShowKey((s) => !s);
      return;
    }
    if (revealed !== undefined) {
      setShowKey((s) => !s);
      return;
    }
    setRevealLoading(true);
    try {
      const payload = await revealImageProviderConfigApiKey(providerId);
      setRevealed(payload.apiKey ?? null);
      setShowKey(true);
    } catch (e) {
      setRevealErr(e instanceof Error ? e.message : labels.loadFailed);
      setRevealed(null);
    } finally {
      setRevealLoading(false);
    }
  }, [masked, providerId, revealed, labels.loadFailed]);

  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
      <label className="text-xs font-medium text-fg-muted" htmlFor={`img-cred-key-${providerId}`}>
        {labels.apiKeyLabel}
      </label>
      {apiKeyLinks.length > 0 ? (
        <div className="flex flex-col gap-1">
          {apiKeyLinks.map((link) => (
            <a
              key={`${link.kind}-${link.href}`}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {providerApiKeyLinkLabel(link.kind, apiKeyLinkLabels)}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
        </div>
      ) : null}
      {masked ? <p className="text-[11px] text-fg-subtle">{labels.maskedHelp}</p> : null}
      <div className="relative min-w-0">
        <input
          id={`img-cred-key-${providerId}`}
          type={inputType}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-3 pr-24 font-mono text-sm text-fg',
            'placeholder:text-fg-subtle',
            settingsInputFocusClass,
          )}
          value={inputValue}
          placeholder={masked ? '••••••••' : labels.optionalPlaceholder}
          onChange={(e) => {
            const next = e.target.value;
            if (masked && typeof revealed === 'string' && showKey && next !== revealed) {
              setRevealed(undefined);
              setShowKey(false);
            }
            onChange(next);
          }}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
          {copyEnabled ? (
            <button
              type="button"
              className={cn(
                'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg',
                interaction.transition,
                interaction.press,
                interaction.focusRingPanel,
              )}
              title={copied ? labels.copied : labels.copy}
              aria-label={copied ? labels.copied : labels.copy}
              onClick={() => void copyKey()}
            >
              {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-40',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
            )}
            title={showKey ? labels.hide : labels.show}
            aria-label={showKey ? labels.hide : labels.show}
            disabled={revealLoading}
            onClick={() => void toggleEye()}
          >
            {revealLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : showKey ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </div>
      {masked && showKey && revealed === null && !revealErr ? (
        <p className="text-xs text-amber-700 dark:text-amber-400/90">{labels.notInConfigFile}</p>
      ) : null}
      {revealErr ? <p className="text-xs text-red-600 dark:text-red-400">{revealErr}</p> : null}
    </div>
  );
}
