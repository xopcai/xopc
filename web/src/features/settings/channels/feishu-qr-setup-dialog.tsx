import { ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchFeishuSetupStart,
  fetchFeishuSetupStatus,
} from '@/features/settings/channels-config-api';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { ChannelsSettingsDialogFooter } from './channels-settings-dialog-footer';
import { ChannelSettingsShell, type ChannelSettingsPresentation } from './channel-settings-shell';

type FeishuDomain = 'feishu' | 'lark';

export function FeishuQrSetupDialog({
  open,
  onOpenChange,
  ch,
  onSetupSuccess,
  moreSettings,
  settingsDirty = false,
  settingsSaving = false,
  onSettingsDiscard,
  onSettingsSave,
  presentation = 'modal',
  closeOnSetupSuccess = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentation?: ChannelSettingsPresentation;
  closeOnSetupSuccess?: boolean;
  ch: ChannelsSettingsMessages;
  onSetupSuccess: (result: { appId: string; domain: string; openId?: string }) => void;
  moreSettings?: ReactNode;
  settingsDirty?: boolean;
  settingsSaving?: boolean;
  onSettingsDiscard?: () => void;
  onSettingsSave?: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState<FeishuDomain>('feishu');
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);

  const startScan = useCallback(async (d: FeishuDomain) => {
    setDomain(d);
    setError(null);
    setSessionKey(null);
    setQrUrl(null);
    setBusy(true);
    try {
      const result = await fetchFeishuSetupStart({ domain: d });
      setQrUrl(result.qrUrl);
      setSessionKey(result.sessionKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSessionKey(null);
      setQrUrl(null);
      setError(null);
      setQrDataUrl(null);
      setQrGenFailed(false);
      setDomain('feishu');
      setBusy(false);
      return;
    }
    void startScan('feishu');
  }, [open, startScan]);

  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    let intervalId: number | undefined;

    const poll = async () => {
      try {
        const status = await fetchFeishuSetupStatus(sessionKey);
        if (cancelled) return;

        if (status.phase === 'polling') return;

        if (status.phase === 'done') {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
            intervalId = undefined;
          }
          setSessionKey(null);
          if (status.ok) {
            setQrUrl(null);
            if (closeOnSetupSuccess) onOpenChange(false);
            onSetupSuccess({
              appId: status.appId,
              domain: status.domain,
              openId: status.openId,
            });
          } else {
            setError(status.message);
            setQrUrl(null);
          }
          return;
        }

        if (status.phase === 'unknown') {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
          setError(status.message);
          setSessionKey(null);
          setQrUrl(null);
        }
      } catch (e) {
        if (!cancelled) {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
          setError(e instanceof Error ? e.message : 'Request failed');
          setSessionKey(null);
          setQrUrl(null);
        }
      }
    };

    intervalId = window.setInterval(() => void poll(), 3000);
    void poll();
    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [sessionKey, onOpenChange, onSetupSuccess]);

  useEffect(() => {
    if (!qrUrl) {
      setQrDataUrl(null);
      setQrGenFailed(false);
      return;
    }
    let cancelled = false;
    setQrGenFailed(false);
    void QRCode.toDataURL(qrUrl, {
      width: 208,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setQrGenFailed(true);
          setQrDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [qrUrl]);

  const showQr = Boolean(qrUrl && sessionKey);
  /** Keep pill visible for the whole open session so region toggles do not collapse the modal. */
  const showRegionSwitch = open;
  /** True until the first QR session is ready (covers first paint before useEffect + region switches). */
  const qrFrameLoading = open && !error && !showQr;

  return (
    <ChannelSettingsShell
      presentation={presentation}
      open={open}
      onOpenChange={onOpenChange}
      title={ch.feishuTitle}
      description={ch.feishuSubtitle}
      srTitle={ch.feishuQrModalTitle}
      srDescription={ch.feishuQrModalSubtitle}
      closeAriaLabel={ch.feishuQrCloseAria}
      wide
      footer={
        moreSettings && onSettingsDiscard && onSettingsSave ? (
          <ChannelsSettingsDialogFooter
            ch={ch}
            dirty={settingsDirty}
            saving={settingsSaving}
            showCancel={false}
            onCancel={() => onOpenChange(false)}
            onDiscard={onSettingsDiscard}
            onSave={onSettingsSave}
          />
        ) : undefined
      }
    >
      <div className="text-center">
        <p className="text-base font-semibold tracking-tight text-fg">{ch.feishuQrModalTitle}</p>
        <p className="mt-1.5 text-sm text-fg-muted">{ch.feishuQrModalSubtitle}</p>
      </div>

      <div className="mt-6 flex min-h-[17.5rem] flex-col items-center justify-center gap-3">
            {error ? (
              <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            {!error && (showQr || qrFrameLoading) ? (
              <div className="flex w-full flex-col items-center gap-3">
                <p className="text-sm text-fg-muted">
                  {qrFrameLoading ? ch.feishuQrStarting : ch.feishuQrScanHint}
                </p>
                <div
                  className={cn(
                    'relative flex size-52 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge-subtle bg-white p-3 dark:border-edge',
                    qrFrameLoading && 'bg-surface-muted/40 dark:bg-surface-base',
                  )}
                >
                  {qrFrameLoading ? (
                    <div
                      className="absolute inset-3 animate-pulse rounded-md bg-surface-muted dark:bg-surface-hover"
                      aria-hidden
                    />
                  ) : null}
                  {showQr && qrUrl && !error && qrDataUrl && !qrGenFailed ? (
                    <img src={qrDataUrl} alt="" className="relative z-[1] size-full object-contain" />
                  ) : null}
                  {showQr && qrUrl && !error && !qrDataUrl && !qrGenFailed && !qrFrameLoading ? (
                    <p className="relative z-[1] px-2 text-center text-sm text-fg-muted">{ch.feishuQrEncoding}</p>
                  ) : null}
                  {showQr && qrUrl && !error && qrGenFailed ? (
                    <div className="relative z-[1] flex size-full flex-col items-center justify-center gap-2 px-1">
                      <p className="text-center text-xs text-fg-muted">{ch.feishuQrImageError}</p>
                      <a
                        href={qrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-3 shrink-0" />
                        {ch.feishuQrOpenLink}
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {showRegionSwitch ? (
            <div
              className="mx-auto mt-4 flex w-full max-w-[20rem] justify-center px-1"
              role="group"
              aria-label={ch.feishuRegionSwitchAria}
            >
              <div className="inline-flex w-full rounded-full border border-edge bg-surface-muted/60 p-1 dark:border-edge dark:bg-surface-base">
                <button
                  type="button"
                  disabled={busy}
                  className={cn(
                    'min-w-0 flex-1 rounded-full px-3 py-2 text-center text-sm font-medium transition-colors',
                    domain === 'feishu'
                      ? 'bg-surface-panel text-fg shadow-sm dark:bg-surface-panel'
                      : 'text-fg-muted hover:text-fg',
                  )}
                  onClick={() => void startScan('feishu')}
                >
                  {ch.feishuRegionChina}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={cn(
                    'min-w-0 flex-1 rounded-full px-3 py-2 text-center text-sm font-medium transition-colors',
                    domain === 'lark'
                      ? 'bg-surface-panel text-fg shadow-sm dark:bg-surface-panel'
                      : 'text-fg-muted hover:text-fg',
                  )}
                  onClick={() => void startScan('lark')}
                >
                  {ch.feishuRegionInternational}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-6">
            <Button
              type="button"
              variant="secondary"
              className="h-11 w-full rounded-full border-0 bg-fg text-surface-panel hover:opacity-90 dark:bg-fg dark:text-surface-panel"
              disabled={busy}
              onClick={() => void startScan(domain)}
            >
              {busy ? ch.feishuQrStarting : ch.feishuQrRegenerate}
            </Button>
          </div>

      {moreSettings ? (
        <div className="mt-6 border-t border-edge-subtle pt-4 dark:border-edge-subtle">{moreSettings}</div>
      ) : null}
    </ChannelSettingsShell>
  );
}
