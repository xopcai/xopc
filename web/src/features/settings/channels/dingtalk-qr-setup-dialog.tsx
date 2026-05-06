import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchDingtalkSetupStart,
  fetchDingtalkSetupStatus,
} from '@/features/settings/channels-config-api';
import { cn } from '@/lib/cn';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

export function DingtalkQrSetupDialog({
  open,
  onOpenChange,
  ch,
  onSetupSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ch: ChannelsSettingsMessages;
  onSetupSuccess: (result: { clientId: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);
  const [showStart, setShowStart] = useState(true);

  const startScan = useCallback(async () => {
    setError(null);
    setSessionKey(null);
    setQrUrl(null);
    setBusy(true);
    setShowStart(false);
    try {
      const result = await fetchDingtalkSetupStart();
      setQrUrl(result.qrUrl);
      setSessionKey(result.sessionKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed');
      setShowStart(true);
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
      setShowStart(true);
      setBusy(false);
    }
  }, [open]);

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
            setShowStart(true);
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
          setShowStart(true);
        }
      } catch (e) {
        if (!cancelled) {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
          setError(e instanceof Error ? e.message : 'Request failed');
          setSessionKey(null);
          setQrUrl(null);
          setShowStart(true);
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[60] max-h-[min(90vh,52rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2',
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

          {showStart && !showQr ? (
            <div className="mt-6 flex flex-col items-center gap-4">
              <Button
                type="button"
                variant="primary"
                className="h-11 w-full rounded-full"
                disabled={busy}
                onClick={() => void startScan()}
              >
                {busy ? ch.dingtalkQrStarting : ch.dingtalkQrStartButton}
              </Button>
            </div>
          ) : null}

          <div className="mt-6 flex min-h-[200px] flex-col items-center justify-center">
            {busy && !showQr ? <p className="text-sm text-fg-muted">{ch.dingtalkQrStarting}</p> : null}

            {error ? (
              <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            {showQr && qrUrl && !error ? (
              <div className="flex w-full flex-col items-center gap-3">
                <p className="text-sm text-fg-muted">{ch.dingtalkQrScanHint}</p>
                {qrDataUrl && !qrGenFailed ? (
                  <img
                    src={qrDataUrl}
                    alt=""
                    className="h-52 w-52 rounded-lg border border-edge-subtle bg-white object-contain p-3 dark:border-edge"
                  />
                ) : null}
                {!qrDataUrl && !qrGenFailed ? (
                  <p className="text-sm text-fg-muted">{ch.dingtalkQrEncoding}</p>
                ) : null}
                {qrGenFailed ? (
                  <div className="flex w-full flex-col items-center gap-3">
                    <p className="max-w-[16rem] text-center text-sm text-fg-muted">{ch.dingtalkQrImageError}</p>
                    <a
                      href={qrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="size-3.5 shrink-0" />
                      {ch.dingtalkQrOpenLink}
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {showQr ? (
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
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
