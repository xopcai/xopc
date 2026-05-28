import { ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchWeixinGatewayQrLoginStart,
  fetchWeixinGatewayQrLoginStatus,
} from '@/features/settings/channels-config-api';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAsyncResource } from '@/lib/use-async-resource';

import { ChannelsSettingsDialogFooter } from './channels-settings-dialog-footer';
import { ChannelSettingsShell, type ChannelSettingsPresentation } from './channel-settings-shell';

const QR_IMAGE_OPTIONS = {
  width: 208,
  margin: 2,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#000000ff', light: '#ffffffff' },
};

type QrStartData = { sessionKey: string | null; qrcodeUrl: string | null };

const emptyQrStart: QrStartData = { sessionKey: null, qrcodeUrl: null };

function WeixinQrLoginSession({
  ch,
  onLoginSuccess,
  onOpenChange,
  closeOnLoginSuccess,
  moreSettings,
}: {
  ch: ChannelsSettingsMessages;
  onLoginSuccess: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  closeOnLoginSuccess: boolean;
  moreSettings?: ReactNode;
}) {
  const [generation, setGeneration] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const onLoginSuccessRef = useRef(onLoginSuccess);
  const onOpenChangeRef = useRef(onOpenChange);
  onLoginSuccessRef.current = onLoginSuccess;
  onOpenChangeRef.current = onOpenChange;

  const start = useAsyncResource(
    () =>
      fetchWeixinGatewayQrLoginStart().then((r) => ({
        sessionKey: r.sessionKey,
        qrcodeUrl: r.qrcodeUrl,
      })),
    [generation],
    { initial: emptyQrStart, errorData: emptyQrStart },
  );

  const sessionKey = start.data.sessionKey;
  const qrcodeUrl = start.data.qrcodeUrl;
  const busy = start.loading;
  const startError =
    start.error instanceof Error
      ? start.error.message
      : start.error
        ? String(start.error)
        : null;
  const error = pollError ?? startError;

  const restart = useCallback(() => {
    setPollError(null);
    setHint(null);
    setGeneration((g) => g + 1);
  }, []);

  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    let intervalId: number | undefined;

    const poll = async () => {
      try {
        const st = await fetchWeixinGatewayQrLoginStatus(sessionKey);
        if (cancelled) return;
        if (st.phase === 'polling') {
          start.setData((prev) => ({ ...prev, qrcodeUrl: st.qrcodeUrl }));
          setHint(st.qrStatus === 'scaned' ? ch.weixinQrLoginScanned : null);
          return;
        }
        if (st.phase === 'done') {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
            intervalId = undefined;
          }
          start.setData(emptyQrStart);
          if (st.ok) {
            if (closeOnLoginSuccess) onOpenChangeRef.current(false);
            await onLoginSuccessRef.current();
          } else {
            setPollError(st.message);
          }
          return;
        }
        if (st.phase === 'unknown') {
          setHint(null);
        }
      } catch (e) {
        if (!cancelled) {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
          setPollError(e instanceof Error ? e.message : 'Request failed');
          start.setData(emptyQrStart);
        }
      }
    };

    intervalId = window.setInterval(() => void poll(), 2000);
    void poll();
    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [sessionKey, ch.weixinQrLoginScanned, closeOnLoginSuccess, start.setData]);

  const qrImage = useAsyncResource(
    () => QRCode.toDataURL(qrcodeUrl!, QR_IMAGE_OPTIONS),
    [qrcodeUrl],
    { enabled: Boolean(qrcodeUrl), initial: null as string | null, errorData: null },
  );

  const qrDataUrl = qrImage.data;
  const qrGenFailed = qrImage.error !== null && !qrImage.loading;

  const showQr = Boolean(qrcodeUrl && sessionKey);
  const qrFrameLoading = !error && !showQr;

  return (
    <>
      <div className="text-center">
        <p className="text-base font-semibold tracking-tight text-fg">{ch.weixinQrModalTitle}</p>
        <p className="mt-1.5 text-sm text-fg-muted">{ch.weixinQrModalSubtitle}</p>
      </div>

      <div className="mt-6 flex min-h-[17.5rem] flex-col items-center justify-center gap-3">
        {error ? <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {!error && (showQr || qrFrameLoading) ? (
          <div className="flex w-full flex-col items-center gap-3">
            <p
              className={cn(
                'min-h-[1.25rem] text-center text-sm',
                hint && !qrFrameLoading ? 'text-accent' : 'text-fg-muted',
              )}
            >
              {qrFrameLoading ? ch.weixinQrLoginBusy : hint ?? '\u00a0'}
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
              {showQr && qrcodeUrl && !error && qrDataUrl && !qrGenFailed ? (
                <img src={qrDataUrl} alt="" className="relative z-[1] size-full object-contain" />
              ) : null}
              {showQr && qrcodeUrl && !error && !qrDataUrl && !qrGenFailed && !qrFrameLoading ? (
                <p className="relative z-[1] px-2 text-center text-sm text-fg-muted">{ch.weixinQrEncoding}</p>
              ) : null}
              {showQr && qrcodeUrl && !error && qrGenFailed ? (
                <div className="relative z-[1] flex size-full flex-col items-center justify-center gap-2 px-1">
                  <p className="text-center text-xs text-fg-muted">{ch.weixinQrImageError}</p>
                  <a
                    href={qrcodeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    {ch.weixinQrOpenLink}
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
          onClick={restart}
        >
          {busy ? ch.weixinQrLoginBusy : ch.weixinQrRegenerate}
        </Button>
      </div>

      {moreSettings ? (
        <div className="mt-6 border-t border-edge-subtle pt-4 dark:border-edge-subtle">{moreSettings}</div>
      ) : null}
    </>
  );
}

export function WeixinQrLoginDialog({
  open,
  onOpenChange,
  ch,
  onLoginSuccess,
  moreSettings,
  settingsDirty = false,
  settingsSaving = false,
  onSettingsDiscard,
  onSettingsSave,
  presentation = 'modal',
  closeOnLoginSuccess = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentation?: ChannelSettingsPresentation;
  closeOnLoginSuccess?: boolean;
  ch: ChannelsSettingsMessages;
  onLoginSuccess: () => void | Promise<void>;
  moreSettings?: ReactNode;
  settingsDirty?: boolean;
  settingsSaving?: boolean;
  onSettingsDiscard?: () => void;
  onSettingsSave?: () => Promise<boolean>;
}) {
  return (
    <ChannelSettingsShell
      presentation={presentation}
      open={open}
      onOpenChange={onOpenChange}
      title={ch.weixinTitle}
      description={ch.weixinSubtitle}
      srTitle={ch.weixinQrModalTitle}
      srDescription={ch.weixinQrModalSubtitle}
      closeAriaLabel={ch.weixinQrModalCloseAria}
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
      {open ? (
        <WeixinQrLoginSession
          key="active"
          ch={ch}
          onLoginSuccess={onLoginSuccess}
          onOpenChange={onOpenChange}
          closeOnLoginSuccess={closeOnLoginSuccess}
          moreSettings={moreSettings}
        />
      ) : null}
    </ChannelSettingsShell>
  );
}
