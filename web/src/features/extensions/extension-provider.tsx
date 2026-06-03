import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';

import { useGatewayStore } from '@/stores/gateway-store';
import { useContextStore } from '@/stores/context-store';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useThemeStore } from '@/stores/theme-store';

import { ExtensionMessageRouter, registerBuiltinMethods } from './extension-message-router';
import { extensionExposesGatewayShellUi } from './extension-ui-guards';
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

  useEffect(() => {
    if (!hasToken) return;
    void useContextStore.getState().fetchContext();
  }, [hasToken]);

  useEffect(() => {
    const onCtx = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        useContextStore.getState().updateContext(detail);
      }
    };
    const refetch = () => {
      void useContextStore.getState().fetchContext();
    };
    window.addEventListener('context-update', onCtx);
    window.addEventListener('config-reload', refetch);
    window.addEventListener('registry-updated', refetch);
    return () => {
      window.removeEventListener('context-update', onCtx);
      window.removeEventListener('config-reload', refetch);
      window.removeEventListener('registry-updated', refetch);
    };
  }, []);

  const handleAgentStreamEvent = useCallback(
    (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: string; event?: unknown }>).detail;
      if (!detail?.sessionKey) return;
      router.forwardAgentStreamEvent(detail.sessionKey, detail.event ?? detail);
    },
    [router],
  );

  const handleAgentStreamEventRef = useRef(handleAgentStreamEvent);
  handleAgentStreamEventRef.current = handleAgentStreamEvent;

  useEffect(() => {
    const onAgentStreamEvent = (event: Event) => {
      handleAgentStreamEventRef.current(event);
    };
    window.addEventListener('agent-stream-event', onAgentStreamEvent);
    return () => {
      window.removeEventListener('agent-stream-event', onAgentStreamEvent);
    };
  }, []);

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
