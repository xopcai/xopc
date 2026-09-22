import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';
import { useGatewayStore } from '@/stores/gateway-store';

import { buildExtensionAssetUrl } from './extension-asset-url';
import { ExtensionPermissionDialog } from './extension-permission-dialog';
import { confirmExtensionUiGrant, resolveExtensionUiGrant } from './extension-authoritative-grants';
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
  grantResolved: boolean;
  grantError: string | null;
  manifestDigest: string | null;
  grantedPermissions: string[];
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
  const gatewayUrl = useGatewayStore(state => state.baseUrl);
  const namespace = useGatewayStore(state => state.conversationId);
  const generation = useRef(0);
  const confirming = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resolved = useThemeStore((s) => s.resolved);
  const displayName = extensionName?.trim() || extensionId;
  const iframeTitle = title?.trim() || `Extension ${extensionId}`;
  const permsKey = useMemo(
    () => JSON.stringify(Array.from(permissions ?? []).toSorted()),
    [permissions],
  );
  /** Stable list so registerIframe effect does not churn every render (permissions ?? [] is a new []). */
  const permList = useMemo(() => JSON.parse(permsKey) as string[], [permsKey]);

  const [ui, dispatch] = useReducer(uiPatchReducer<IframeHostUi>, {
    allowed: false,
    dialogOpen: false,
    reloadKey: 0,
    loadError: false,
    dynamicHeight: fixedHeight ?? Math.min(maxHeight, Math.max(minHeight, 320)),
    grantResolved: false,
    grantError: null,
    manifestDigest: null,
    grantedPermissions: [],
  });
  const { allowed, dialogOpen, reloadKey, loadError, dynamicHeight, grantResolved, grantError } = ui;

  useEffect(() => {
    let active = true;
    confirming.current = false;
    dispatch({ type: 'patch', patch: { allowed: false, dialogOpen: false, grantResolved: false, grantError: null, manifestDigest: null, grantedPermissions: [] } });
    void resolveExtensionUiGrant(extensionId).then((grant) => {
      if (!active) return;
      if (grant.extensionId !== extensionId || !grant.manifestDigest) throw new Error('Could not verify extension permissions');
      dispatch({
        type: 'patch',
        patch: {
          allowed: grant.granted,
          dialogOpen: !grant.granted,
          grantResolved: true,
          manifestDigest: grant.manifestDigest,
          grantedPermissions: grant.permissions,
        },
      });
    }).catch((cause) => {
      if (!active) return;
      dispatch({
        type: 'patch',
        patch: {
          allowed: false,
          dialogOpen: true,
          grantResolved: true,
          grantError: cause instanceof Error ? cause.message : String(cause),
        },
      });
    });
    return () => { active = false; generation.current += 1; };
  }, [extensionId, permList, gatewayUrl, namespace, reloadKey]);

  const setDialogOpen = useCallback(
    (open: boolean) => dispatch({ type: 'patch', patch: { dialogOpen: open } }),
    [],
  );

  const src = useMemo(
    () => buildExtensionAssetUrl(extensionId, entrypoint),
    [extensionId, entrypoint],
  );

  useLayoutEffect(() => {
    if (!allowed) return;
    const el = iframeRef.current;
    if (!el) return;
    router.registerIframe(extensionId, el, ui.grantedPermissions, ui.manifestDigest ?? undefined);
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
  }, [allowed, extensionId, fixedHeight, maxHeight, minHeight, ui.grantedPermissions, ui.manifestDigest, router, reloadKey]);

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
    if (confirming.current || !ui.manifestDigest) return;
    confirming.current = true;
    const current = generation.current;
    const isCurrent = () => generation.current === current && useGatewayStore.getState().baseUrl === gatewayUrl
      && useGatewayStore.getState().conversationId === namespace;
    void confirmExtensionUiGrant(extensionId, ui.manifestDigest).then((grant) => {
      if (!isCurrent()) return;
      if (!grant.granted || grant.extensionId !== extensionId || grant.manifestDigest !== ui.manifestDigest) throw new Error('Permission grant was not persisted');
      dispatch({ type: 'patch', patch: { allowed: true, grantError: null } });
    }).catch((cause) => {
      if (!isCurrent()) return;
      dispatch({
        type: 'patch',
        patch: { allowed: false, manifestDigest: null, grantError: cause instanceof Error ? cause.message : String(cause) },
      });
    }).finally(() => { if (isCurrent()) confirming.current = false; });
  };

  if (!grantResolved) {
    return <div className={`${className ?? ''} min-h-32 animate-pulse rounded-lg bg-surface-inset`} />;
  }

  if (!allowed) {
    return (
      <>
        <ExtensionPermissionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          extensionId={extensionId}
          extensionName={displayName}
          permissions={ui.grantedPermissions}
          confirmDisabled={!ui.manifestDigest}
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
            {grantError ? <p className="mb-2 text-danger">{grantError}</p> : null}
            <p>{t.deniedHint}</p>
            <button
              type="button"
              className="mt-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
              onClick={() => dispatch({ type: 'patch', patch: { reloadKey: reloadKey + 1 } })}
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
