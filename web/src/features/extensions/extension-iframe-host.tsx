import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useThemeStore } from '@/stores/theme-store';
import { apiUrl } from '@/lib/url';

import { ExtensionPermissionDialog } from './extension-permission-dialog';
import { hasUiGrant, saveUiGrant } from './extension-permission-grants';
import { useExtensionRouter } from './extension-provider';
import { buildThemeInfo } from './theme-bridge';

const DEFAULT_MIN = 48;
const DEFAULT_MAX = 2000;

/** Sandboxed extension UI: no `allow-same-origin` so the document is opaque-isolated from the host origin. */
const EXTENSION_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups';

export type ExtensionIframeHostProps = {
  extensionId: string;
  /** Display name for the permission dialog; falls back to `extensionId`. */
  extensionName?: string;
  entrypoint: string;
  permissions?: string[];
  title?: string;
  className?: string;
  fixedHeight?: number;
  maxHeight?: number;
  minHeight?: number;
  initialData?: unknown;
};

function encodeAssetPath(entrypoint: string): string {
  return entrypoint
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export function ExtensionIframeHost({
  extensionId,
  extensionName,
  entrypoint,
  permissions,
  title,
  className,
  fixedHeight,
  maxHeight = DEFAULT_MAX,
  minHeight = DEFAULT_MIN,
  initialData,
}: ExtensionIframeHostProps) {
  const { t } = useTranslation();
  const router = useExtensionRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const gatewayToken = useGatewayStore((s) => s.token);
  const resolved = useThemeStore((s) => s.resolved);
  const displayName = extensionName?.trim() || extensionId;
  const iframeTitle = title?.trim() || `Extension ${extensionId}`;
  const permsKey = useMemo(
    () => JSON.stringify(Array.from(permissions ?? []).toSorted()),
    [permissions],
  );
  /** Stable list so registerIframe effect does not churn every render (permissions ?? [] is a new []). */
  const permList = useMemo(() => JSON.parse(permsKey) as string[], [permsKey]);

  const [allowed, setAllowed] = useState(() => hasUiGrant(extensionId, permList));
  const [dialogOpen, setDialogOpen] = useState(() => !hasUiGrant(extensionId, permList));
  const trackedGrantKeyRef = useRef({ id: extensionId, k: permsKey });
  if (trackedGrantKeyRef.current.id !== extensionId || trackedGrantKeyRef.current.k !== permsKey) {
    trackedGrantKeyRef.current = { id: extensionId, k: permsKey };
    const ok = hasUiGrant(extensionId, permList);
    setAllowed(ok);
    setDialogOpen(!ok);
  }
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState(false);

  const [dynamicHeight, setDynamicHeight] = useState(
    fixedHeight ?? Math.min(maxHeight, Math.max(minHeight, 320)),
  );

  const src = useMemo(() => {
    const rel = encodeAssetPath(entrypoint);
    const base = apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/assets/${rel}`);
    if (!gatewayToken?.trim()) {
      return base;
    }
    const u = new URL(base);
    u.searchParams.set('token', gatewayToken.trim());
    return u.toString();
  }, [extensionId, entrypoint, gatewayToken]);

  useLayoutEffect(() => {
    if (!allowed) return;
    const el = iframeRef.current;
    if (!el) return;
    router.registerIframe(extensionId, el, permList);
    return () => router.unregisterIframe(extensionId);
  }, [allowed, extensionId, permList, router]);

  useEffect(() => {
    if (!allowed) return;
    return router.subscribeExtensionEvents(extensionId, (msg) => {
      if (msg.event !== 'ui.resize') return;
      if (!msg.data || typeof msg.data !== 'object' || msg.data === null) return;
      const h = Number((msg.data as { height?: unknown }).height);
      if (!Number.isFinite(h)) return;
      const clamped = Math.min(maxHeight, Math.max(minHeight, h));
      if (fixedHeight === undefined) {
        setDynamicHeight(clamped);
      }
    });
  }, [allowed, extensionId, fixedHeight, maxHeight, minHeight, router]);

  useEffect(() => {
    if (!allowed) return;
    const th = buildThemeInfo(resolved);
    router.sendEvent(extensionId, 'theme.changed', th);
  }, [allowed, extensionId, resolved, router]);

  const style: CSSProperties =
    fixedHeight !== undefined
      ? { width: '100%', height: fixedHeight, border: 'none' }
      : { width: '100%', height: dynamicHeight, border: 'none' };

  const handleConfirmGrant = () => {
    saveUiGrant(extensionId, permList);
    setAllowed(true);
  };

  if (!allowed) {
    return (
      <>
        <ExtensionPermissionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          extensionId={extensionId}
          extensionName={displayName}
          permissions={permList}
          onConfirm={handleConfirmGrant}
        />
        {!dialogOpen ? (
          <div
            className={
              className
                ? `${className} rounded-lg border border-edge border-dashed bg-surface-base p-4 text-sm text-fg-muted`
                : 'rounded-lg border border-edge border-dashed bg-surface-base p-4 text-sm text-fg-muted'
            }
          >
            <p>{t('extensionUi.deniedHint')}</p>
            <button
              type="button"
              className="mt-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
              onClick={() => setDialogOpen(true)}
            >
              {t('extensionUi.reviewPermissions')}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col">
      {loadError ? (
        <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-fg">
          <p>{t('extensionUi.loadFailed')}</p>
          <p className="mt-2 text-xs text-fg-muted">{t('extensionUi.loadFailedConnectionHint')}</p>
          <button
            type="button"
            className="mt-2 font-medium text-accent underline-offset-2 hover:underline"
            onClick={() => {
              setLoadError(false);
              setReloadKey((k) => k + 1);
            }}
          >
            {t('extensionUi.retryLoad')}
          </button>
        </div>
      ) : null}
      <iframe
        key={`${extensionId}-${entrypoint}-${reloadKey}`}
        ref={iframeRef}
        className={className}
        title={iframeTitle}
        src={src}
        style={style}
        sandbox={EXTENSION_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        onError={() => setLoadError(true)}
        onLoad={() => {
          setLoadError(false);
          const locale = useLocaleStore.getState().language;
          router.sendInit(extensionId, buildThemeInfo(useThemeStore.getState().resolved), locale);
          if (initialData !== undefined) {
            router.sendEvent(extensionId, 'widget.data', initialData);
          }
        }}
      />
    </div>
  );
}
