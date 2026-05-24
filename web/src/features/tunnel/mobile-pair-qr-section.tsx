import { Check, Copy, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import type { MobilePairQrState } from '@/features/tunnel/use-mobile-pair-qr';
import { useEnableLanPairing } from '@/features/tunnel/use-enable-lan-pairing';
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

export function MobilePairQrSection({
  pairQr,
  gatewayToken,
  streamlined = false,
  onRefreshQr,
}: {
  pairQr: MobilePairQrState;
  gatewayToken: string;
  streamlined?: boolean;
  onRefreshQr?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).tunnelSettings;
  const {
    tunnelActive,
    tunnelStatus,
    tunnelQr,
    pairContext,
    pairBaseUrl,
    setPairBaseUrl,
    applySuggestedPairUrl,
    applyCandidateUrl,
    resetPairBaseFromContext,
    baseOk,
    localhostWarn,
    pairingBlocked,
    deepLink,
    qrPayload,
    qrDataUrl,
    qrGenFailed,
    encoding,
    linkCopied,
    copyDeepLink,
  } = pairQr;

  const enableLan = useEnableLanPairing(gatewayToken, (context) => {
    resetPairBaseFromContext(context.recommended.url);
  });

  const lanCandidates = pairContext?.candidates.filter((c) => c.kind === 'lan') ?? [];
  const suggestedUrl = pairContext?.recommended.url?.trim() ?? '';
  const showLanCandidatePicker = !tunnelActive && lanCandidates.length > 1;

  function renderLanCandidateList(tone: 'amber' | 'neutral') {
    if (lanCandidates.length === 0) return null;
    const itemClass =
      tone === 'amber'
        ? 'text-amber-950 dark:text-amber-100'
        : 'text-fg';
    const labelClass =
      tone === 'amber'
        ? 'text-amber-950/80 dark:text-amber-200/90'
        : 'text-fg-muted';
    return (
      <div>
        <div className={cn('text-xs font-medium', labelClass)}>
          {showLanCandidatePicker ? t.pairSelectCandidateTitle : t.pairCandidatesTitle}
        </div>
        <ul className="mt-1 space-y-1">
          {lanCandidates.map((candidate) => (
            <li key={candidate.url}>
              <button
                type="button"
                className={cn(
                  'w-full rounded-md border px-2 py-1.5 text-left font-mono text-[11px] transition-colors',
                  tone === 'amber'
                    ? 'border-amber-300/70 hover:bg-amber-100/80 dark:border-amber-800 dark:hover:bg-amber-950/50'
                    : 'border-edge hover:bg-surface-panel',
                  pairBaseUrl.trim() === candidate.url && 'border-accent bg-accent/5',
                  itemClass,
                )}
                onClick={() => applyCandidateUrl(candidate.url)}
              >
                {candidate.label ? `${candidate.label}: ` : ''}
                {candidate.url}
              </button>
            </li>
          ))}
        </ul>
        {showLanCandidatePicker ? (
          <p className={cn('mt-1 text-[11px] leading-relaxed', labelClass)}>{t.pairSelectCandidateHint}</p>
        ) : null}
      </div>
    );
  }

  if (streamlined && !tunnelActive) {
    return (
      <SettingsFormSection>
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
          {t.pairTitle}
        </div>
        <p className="mt-2 text-sm text-fg-muted">{t.pairWaitingForTunnel}</p>
      </SettingsFormSection>
    );
  }

  const sectionBody = (
    <>
      <div className={cn('flex flex-wrap items-start justify-between gap-2', streamlined ? 'mb-2' : 'mb-3')}>
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
            {t.pairTitle}
          </div>
          {!streamlined ? (
            <p className="mt-1 text-xs text-fg-subtle">
              {tunnelActive ? t.pairTunnelActive : t.pairSubtitle}
            </p>
          ) : (
            <p className="mt-1 text-xs text-fg-subtle">{t.pairSubtitle}</p>
          )}
        </div>
        {streamlined && tunnelActive && onRefreshQr ? (
          <Button type="button" variant="ghost" className="shrink-0" onClick={() => void onRefreshQr()}>
            <RefreshCw className="size-4" />
            {t.refreshQr}
          </Button>
        ) : null}
      </div>

      {pairingBlocked ? (
        <div className="mb-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div>
            <div className="text-sm font-medium text-amber-950 dark:text-amber-100">{t.pairBlockedTitle}</div>
            <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">{t.pairBlockedLoopbackBody}</p>
          </div>
          {suggestedUrl ? (
            <div className="space-y-2">
              <div>
                <div className="text-xs font-medium text-amber-950/80 dark:text-amber-200/90">{t.pairSuggestedLanLabel}</div>
                <div className="mt-0.5 break-all font-mono text-xs text-amber-950 dark:text-amber-100">{suggestedUrl}</div>
              </div>
              <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={applySuggestedPairUrl}>
                {t.pairUseSuggestedUrl}
              </Button>
            </div>
          ) : null}
          {lanCandidates.length > 0 ? renderLanCandidateList('amber') : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={enableLan.busy || !gatewayToken}
              onClick={() => enableLan.setConfirmOpen(true)}
            >
              {enableLan.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {enableLan.busy ? t.pairEnableLanEnabling : t.pairEnableLanButton}
            </Button>
          </div>
          {enableLan.error ? (
            <p className="text-xs text-red-800 dark:text-red-200">{enableLan.error}</p>
          ) : null}
          <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">{t.pairBlockedNextSteps}</p>
          <Link
            to="/settings/gateway"
            className="inline-block text-xs font-medium text-accent hover:underline"
          >
            {t.pairEnableLanSecurityAuditLink}
          </Link>
        </div>
      ) : null}

      {tunnelActive ? (
        !streamlined ? (
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
        ) : null
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
            placeholder={suggestedUrl || t.pairBaseUrlPlaceholder}
            value={pairBaseUrl}
            onChange={(e) => setPairBaseUrl(e.target.value)}
          />
          <p className="text-xs text-fg-subtle">{t.pairBaseUrlHint}</p>
          {!baseOk && pairBaseUrl.trim() ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">{t.pairInvalidBaseUrl}</p>
          ) : null}
          {localhostWarn ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {t.pairLocalhostWarning}
            </p>
          ) : null}
          {showLanCandidatePicker ? renderLanCandidateList('neutral') : null}
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
      ) : pairingBlocked ? (
        <p className="text-sm text-fg-muted">{t.pairQrDisabled}</p>
      ) : null}

      {qrPayload && !streamlined ? (
        <details className="mt-3 rounded-lg border border-edge bg-surface-panel px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">{t.deeplinkTitle}</summary>
          <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-fg-subtle">{qrPayload}</p>
        </details>
      ) : null}

      {!streamlined ? (
        <>
          <p className="mt-3 break-all font-mono text-[10px] leading-relaxed text-fg-subtle">{t.pairSchemeHint}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-fg-subtle">{t.pairMobileProbeHint}</p>
        </>
      ) : null}

      <ConfirmDialog
        open={enableLan.confirmOpen}
        title={t.pairEnableLanConfirmTitle}
        description={t.pairEnableLanConfirmBody}
        confirmLabel={t.pairEnableLanButton}
        cancelLabel={t.consentCancel}
        onConfirm={() => void enableLan.runEnableLanPairing()}
        onCancel={() => {
          if (!enableLan.busy) enableLan.setConfirmOpen(false);
        }}
      />
    </>
  );

  return <SettingsFormSection>{sectionBody}</SettingsFormSection>;
}
