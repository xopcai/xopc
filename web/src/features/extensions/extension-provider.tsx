import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
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
  const routerRef = useRef<ExtensionMessageRouter | undefined>(undefined);
  if (!routerRef.current) {
    routerRef.current = new ExtensionMessageRouter();
    registerBuiltinMethods(routerRef.current);
  }
  const router = routerRef.current;
  if (!router) {
    throw new Error('ExtensionMessageRouter init failed');
  }
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const { data, isLoading } = useSWR(
    hasToken ? 'gateway-extensions-list' : null,
    () => fetchJson<ExtensionsListResponse>(apiUrl('/api/extensions')),
    { revalidateOnFocus: false },
  );

  const extensions = data?.extensions ?? [];
  const resolved = useThemeStore((s) => s.resolved);

  useEffect(() => {
    const theme = buildThemeInfo(resolved);
    router.broadcastEvent('theme.changed', theme);
  }, [resolved, router]);

  useEffect(
    () => () => {
      router.dispose();
    },
    [router],
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
  return useMemo(() => list.filter((e) => e.active && e.hasUi), [list]);
}

export function useExtensionsLoading(): boolean {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error('useExtensionsLoading must be used within ExtensionProvider');
  }
  return ctx.loading;
}
