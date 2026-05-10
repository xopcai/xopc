import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchDingtalkSetupStart,
  fetchDingtalkSetupStatus,
} from '@/features/settings/channels-config-api';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

export function DingtalkQrSetupDialog({
  open,
  onOpenChange,
  ch,
  onSetupSuccess,
  moreSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ch: ChannelsSettingsMessages;
  onSetupSuccess: (result: { clientId: string }) => void;
  moreSettings?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);

  const startScan = useCallback(async () => {
    setError(null);
    setSessionKey(null);
    setQrUrl(null);
    setBusy(true);
    try {
      const result = await fetchDingtalkSetupStart();
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
      setBusy(false);
      return;
    }
    void startScan();
  }, [open, startScan]);

  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    let intervalId: number | undefined;

    const poll = async () => {
      try {
        const status = await fetchDingtalkSetupStatus(sessionKey);
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
            onOpenChange(false);
            onSetupSuccess({ clientId: status.clientId });
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
  /** True while waiting for a new session (first open, regenerate, or after errors). Keeps modal height stable. */
  const qrFrameLoading = open && !error && !showQr;

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
            'fixed left-1/2 top-1/2 max-h-[min(90vh,52rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2',
            SETTINGS_SHELL_CONTENT_Z,
            'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-3 top-3 z-20 rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={ch.dingtalkQrCloseAria}
            >
              <X className="size-4" />
            </button>
          </Dialog.Close>

          <Dialog.Title className="sr-only">{ch.dingtalkQrModalTitle}</Dialog.Title>
          <Dialog.Description className="sr-only">{ch.dingtalkQrModalSubtitle}</Dialog.Description>

          <div className="text-center">
            <p className="text-lg font-semibold tracking-tight text-fg">{ch.dingtalkQrModalTitle}</p>
            <p className="mt-1.5 text-sm text-fg-muted">{ch.dingtalkQrModalSubtitle}</p>
          </div>

          <div className="mt-6 flex min-h-[17.5rem] flex-col items-center justify-center gap-3">
            {error ? <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p> : null}

            {!error && (showQr || qrFrameLoading) ? (
              <div className="flex w-full flex-col items-center gap-3">
                <p className="text-sm text-fg-muted">
                  {qrFrameLoading ? ch.dingtalkQrStarting : ch.dingtalkQrScanHint}
                </p>
                <div
                  className={cn(
                    'relative flex h-52 w-52 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge-subtle bg-white p-3 dark:border-edge',
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
                    <p className="relative z-[1] px-2 text-center text-sm text-fg-muted">{ch.dingtalkQrEncoding}</p>
                  ) : null}
                  {showQr && qrUrl && !error && qrGenFailed ? (
                    <div className="relative z-[1] flex size-full flex-col items-center justify-center gap-2 px-1">
                      <p className="text-center text-xs text-fg-muted">{ch.dingtalkQrImageError}</p>
                      <a
                        href={qrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-3 shrink-0" />
                        {ch.dingtalkQrOpenLink}
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-6">
            <Button
              type="button"
              variant="secondary"
              className="h-11 w-full rounded-full border-0 bg-fg text-surface-panel hover:opacity-90 dark:bg-fg dark:text-surface-panel"
              disabled={busy}
              onClick={() => void startScan()}
            >
              {busy ? ch.dingtalkQrStarting : ch.dingtalkQrRegenerate}
            </Button>
          </div>

          {moreSettings ? (
            <div className="mt-6 border-t border-edge-subtle pt-4 dark:border-edge-subtle">{moreSettings}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
