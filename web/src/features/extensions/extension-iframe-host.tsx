import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';

import { messages } from '@/i18n/messages';
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

type IframeHostUi = {
  allowed: boolean;
  dialogOpen: boolean;
  reloadKey: number;
  loadError: boolean;
  dynamicHeight: number;
};

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
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).extensionUi;
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

  const initialGranted = hasUiGrant(extensionId, permList);
  const [ui, dispatch] = useReducer(uiPatchReducer<IframeHostUi>, {
    allowed: initialGranted,
    dialogOpen: !initialGranted,
    reloadKey: 0,
    loadError: false,
    dynamicHeight: fixedHeight ?? Math.min(maxHeight, Math.max(minHeight, 320)),
  });
  const { allowed, dialogOpen, reloadKey, loadError, dynamicHeight } = ui;

  const trackedGrantKeyRef = useRef({ id: extensionId, k: permsKey });
  if (trackedGrantKeyRef.current.id !== extensionId || trackedGrantKeyRef.current.k !== permsKey) {
    trackedGrantKeyRef.current = { id: extensionId, k: permsKey };
    const ok = hasUiGrant(extensionId, permList);
    dispatch({ type: 'patch', patch: { allowed: ok, dialogOpen: !ok } });
  }

  const setDialogOpen = useCallback(
    (open: boolean) => dispatch({ type: 'patch', patch: { dialogOpen: open } }),
    [],
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
    const unsubscribe = router.subscribeExtensionEvents(extensionId, (msg) => {
      if (msg.event !== 'ui.resize') return;
      if (!msg.data || typeof msg.data !== 'object' || msg.data === null) return;
      const h = Number((msg.data as { height?: unknown }).height);
      if (!Number.isFinite(h)) return;
      const clamped = Math.min(maxHeight, Math.max(minHeight, h));
      if (fixedHeight === undefined) {
        dispatch({ type: 'patch', patch: { dynamicHeight: clamped } });
      }
    });
    return () => {
      unsubscribe();
      router.unregisterIframe(extensionId);
    };
  }, [allowed, extensionId, fixedHeight, maxHeight, minHeight, permList, router]);

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
    dispatch({ type: 'patch', patch: { allowed: true } });
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
            <p>{t.deniedHint}</p>
            <button
              type="button"
              className="mt-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
              onClick={() => dispatch({ type: 'patch', patch: { dialogOpen: true } })}
            >
              {t.reviewPermissions}
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
          <p>{t.loadFailed}</p>
          <p className="mt-2 text-xs text-fg-muted">{t.loadFailedConnectionHint}</p>
          <button
            type="button"
            className="mt-2 font-medium text-accent underline-offset-2 hover:underline"
            onClick={() => {
              dispatch({ type: 'patch', patch: { loadError: false, reloadKey: reloadKey + 1 } });
            }}
          >
            {t.retryLoad}
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
        onError={() => dispatch({ type: 'patch', patch: { loadError: true } })}
        onLoad={() => {
          dispatch({ type: 'patch', patch: { loadError: false } });
          router.sendInit(extensionId, buildThemeInfo(useThemeStore.getState().resolved), language);
          if (initialData !== undefined) {
            router.sendEvent(extensionId, 'widget.data', initialData);
          }
        }}
      />
    </div>
  );
}
