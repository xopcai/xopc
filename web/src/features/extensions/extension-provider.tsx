import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';

import { useGatewayStore } from '@/stores/gateway-store';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useThemeStore } from '@/stores/theme-store';

import { ExtensionMessageRouter, registerBuiltinMethods } from './extension-message-router';
import type { ExtensionApiRow, ExtensionsListResponse } from './types';
import { buildThemeInfo } from './theme-bridge';

type Ctx = {
  router: ExtensionMessageRouter;
  extensions: ExtensionApiRow[];
  loading: boolean;
};

const ExtensionContext = createContext<Ctx | null>(null);

export function ExtensionProvider({ children }: { children: React.ReactNode }) {
  const routerRef = useRef<ExtensionMessageRouter | null>(null);
  if (!routerRef.current) {
    const newRouter = new ExtensionMessageRouter();
    registerBuiltinMethods(newRouter);
    routerRef.current = newRouter;
  }
  const router = routerRef.current;
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const { data, isLoading } = useSWR(
    hasToken ? 'gateway-extensions-list' : null,
    () => fetchJson<ExtensionsListResponse>(apiUrl('/api/extensions')),
    { revalidateOnFocus: false },
  );

  const extensions = data?.extensions ?? [];
  const resolved = useThemeStore((s) => s.resolved);

  const handleAgentStreamEvent = useCallback(
    (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: string; event?: unknown }>).detail;
      if (!detail?.sessionKey) return;
      router.forwardAgentStreamEvent(detail.sessionKey, detail.event ?? detail);
    },
    [router],
  );

  useEffect(() => {
    window.addEventListener('agent-stream-event', handleAgentStreamEvent);
    return () => {
      window.removeEventListener('agent-stream-event', handleAgentStreamEvent);
    };
  }, [handleAgentStreamEvent]);

  useEffect(() => {
    const theme = buildThemeInfo(resolved);
    router.broadcastEvent('theme.changed', theme);
  }, [resolved, router]);

  const routerForCleanupRef = useRef(router);
  routerForCleanupRef.current = router;
  useEffect(
    () => () => {
      routerForCleanupRef.current.dispose();
      // React StrictMode (dev) invokes this cleanup, then remounts. `useRef` survives,
      // so we must clear the ref or the next render would reuse a disposed router
      // (no `window` message listener — extension requests time out).
      routerRef.current = null;
    },
    [],
  );

  const value = useMemo(
    () => ({ router, extensions, loading: isLoading }),
    [router, extensions, isLoading],
  );

  return <ExtensionContext.Provider value={value}>{children}</ExtensionContext.Provider>;
}

export function useExtensionRouter(): ExtensionMessageRouter {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error('useExtensionRouter must be used within ExtensionProvider');
  }
  return ctx.router;
}

export function useExtensions(): ExtensionApiRow[] {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error('useExtensions must be used within ExtensionProvider');
  }
  return ctx.extensions;
}

/** Loaded in the gateway process (tools/hooks) or marked to load after restart. */
function extensionUiUnlocked(e: ExtensionApiRow): boolean {
  return e.active || e.activationEligible === true;
}

/** Manifest declares iframe surfaces (served from disk); show nav/routes even when Node side is not active yet. */
function manifestDeclaresGatewayContributions(e: ExtensionApiRow): boolean {
  const c = e.ui?.contributions;
  if (!c) return false;
  return (
    (Array.isArray(c.pages) && c.pages.length > 0) ||
    (Array.isArray(c.settingsPanels) && c.settingsPanels.length > 0) ||
    (Array.isArray(c.chatWidgets) && c.chatWidgets.length > 0)
  );
}

/** Used by Apps detail links and {@link useUiExtensions}. */
export function extensionExposesGatewayShellUi(e: ExtensionApiRow): boolean {
  // Extension must be enabled (active or scheduled to activate after restart) before
  // settings / UI contributions appear in the shell.
  if (!extensionUiUnlocked(e)) return false;
  if (e.hasConfigSchema) return true;
  if (!e.hasUi) return false;
  return manifestDeclaresGatewayContributions(e);
}

export function useUiExtensions(): ExtensionApiRow[] {
  const list = useExtensions();
  return useMemo(() => list.filter(extensionExposesGatewayShellUi), [list]);
}

export function useExtensionsLoading(): boolean {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error('useExtensionsLoading must be used within ExtensionProvider');
  }
  return ctx.loading;
}
