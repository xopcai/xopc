import { Check, Copy, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import type { MobilePairQrState } from '@/features/tunnel/use-mobile-pair-qr';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

export function MobilePairQrSection({ pairQr }: { pairQr: MobilePairQrState }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).tunnelSettings;
  const {
    tunnelActive,
    tunnelStatus,
    tunnelQr,
    pairBaseUrl,
    setPairBaseUrl,
    baseOk,
    localhostWarn,
    deepLink,
    qrPayload,
    qrDataUrl,
    qrGenFailed,
    encoding,
    linkCopied,
    copyDeepLink,
  } = pairQr;

  return (
    <SettingsFormSection>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
        <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
        {t.pairTitle}
      </div>
      <p className="mb-3 text-xs text-fg-subtle">
        {tunnelActive ? t.pairTunnelActive : t.pairSubtitle}
      </p>

      {tunnelActive ? (
        <div className="mb-3 space-y-2 rounded-lg border border-edge bg-surface-panel px-3 py-3">
          <div>
            <div className="text-xs font-medium text-fg-muted">{t.pairTunnelPublicUrl}</div>
            <div className="mt-0.5 break-all font-mono text-xs text-fg">{tunnelStatus?.publicUrl}</div>
          </div>
          {tunnelQr?.lanUrl ? (
            <div>
              <div className="text-xs font-medium text-fg-muted">{t.pairTunnelLanUrl}</div>
              <div className="mt-0.5 break-all font-mono text-xs text-fg">{tunnelQr.lanUrl}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mb-3 space-y-1.5">
          <label className="text-sm font-medium text-fg" htmlFor="tunnel-mobile-pair-base">
            {t.pairBaseUrlLabel}
          </label>
          <input
            id="tunnel-mobile-pair-base"
            className={cn(inputClassName(), 'font-mono text-xs')}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={pairBaseUrl}
            onChange={(e) => setPairBaseUrl(e.target.value)}
          />
          <p className="text-xs text-fg-subtle">{t.pairBaseUrlHint}</p>
          {!baseOk ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">{t.pairInvalidBaseUrl}</p>
          ) : null}
          {localhostWarn ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {t.pairLocalhostWarning}
            </p>
          ) : null}
        </div>
      )}

      <p className="mb-3 text-xs text-fg-subtle">{t.pairSecurityNote}</p>

      {deepLink ? (
        <div className="flex flex-col items-center gap-3 sm:items-start">
          {qrDataUrl && !qrGenFailed ? (
            <img
              src={qrDataUrl}
              alt=""
              className="size-56 rounded-lg border border-edge-subtle bg-white object-contain p-3 dark:border-edge"
            />
          ) : null}
          {encoding ? <p className="text-sm text-fg-muted">{t.pairEncoding}</p> : null}
          {qrGenFailed ? (
            <p className="text-center text-sm text-fg-muted sm:text-left">{t.pairImageError}</p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={!deepLink}
            onClick={() => void copyDeepLink()}
          >
            {linkCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {linkCopied ? t.pairCopied : t.pairCopyLink}
          </Button>
        </div>
      ) : null}

      {qrPayload ? (
        <details className="mt-3 rounded-lg border border-edge bg-surface-panel px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">{t.deeplinkTitle}</summary>
          <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-fg-subtle">{qrPayload}</p>
        </details>
      ) : null}

      <p className="mt-3 break-all font-mono text-[10px] leading-relaxed text-fg-subtle">{t.pairSchemeHint}</p>
    </SettingsFormSection>
  );
}
