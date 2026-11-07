import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LocalAppPreviewSessionSchema, type LocalAppPreviewSession, type LocalAppPreviewMode, type LocalAppResourceScopes } from '@xopcai/gateway-contract';

import { Skeleton } from '@/components/ui/skeleton';
import { ExtensionMessageRouter, registerBuiltinMethods } from '@/features/extensions/extension-message-router';
import { buildThemeInfo } from '@/features/extensions/theme-bridge';
import { useThemeStore } from '@/stores/theme-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { attachLocalAppPreviewChannel } from './preview-channel';

export function LocalAppPreviewFrame({ appId, sourceHash, mode, resourceScopes, scenarioId, runKey, title, hidden = false, onMessage }: {
  appId: string; sourceHash: string; mode: LocalAppPreviewMode; resourceScopes?: LocalAppResourceScopes;
  scenarioId?: string; runKey: number; title: string; hidden?: boolean; onMessage: (message: unknown) => void;
}) {
  const gatewayUrl = useGatewayStore(state => state.baseUrl);
  const namespace = useGatewayStore(state => state.conversationId);
  const [bound, setSession] = useState<(LocalAppPreviewSession & { hostBaseUrl: string; hostNamespace: string | undefined;
    hostRunKey: number; hostScopes?: LocalAppResourceScopes; hostScenario?: string }) | null>(null);
  const session = bound?.hostBaseUrl === gatewayUrl && bound?.hostNamespace === namespace
    && bound.appId === appId && bound.sourceHash === sourceHash && bound.mode === mode && bound.hostRunKey === runKey
    && bound.hostScopes === resourceScopes && bound.hostScenario === scenarioId ? bound : null;
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const callback = useRef(onMessage); callback.current = onMessage;
  const routerRef = useRef<ExtensionMessageRouter | null>(null);
  const language = useLocaleStore(state => state.language);
  const theme = useThemeStore(state => state.resolved);
  const fail = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    callback.current({ source: 'xopc-local-app-preview', version: 1, type: 'error', detail: { kind: 'runner_error', message: message.slice(0, 500) } });
  };
  const failure = useRef(fail); failure.current = fail;

  useEffect(() => {
    let active = true;
    let created: LocalAppPreviewSession | undefined;
    const controller = new AbortController();
    const remove = (id: string) => useGatewayStore.getState().baseUrl === gatewayUrl
      ? fetchJson(apiUrl(`/api/local-app-previews/sessions/${encodeURIComponent(id)}`), { method: 'DELETE', keepalive: true }).catch(() => {})
      : Promise.resolve();
    const dispose = () => { active = false; controller.abort(); if (created) void remove(created.id); };
    window.addEventListener('pagehide', dispose);
    setSession(null); setError('');
    const create = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fetchJson<{ session: LocalAppPreviewSession }>(apiUrl(`/api/local-app-previews/${encodeURIComponent(appId)}/sessions`), {
            method: 'POST', signal: controller.signal, body: JSON.stringify({ sourceHash, mode, resourceScopes, scenarioId }),
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (!active || attempt >= 2 || !/Too many isolated preview workers|Close another preview/.test(message)) throw cause;
          // Give revoked workers time to exit before asking the host to reclaim an idle slot again.
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, 1000);
            controller.signal.addEventListener('abort', done, { once: true });
          });
          if (!active) throw cause;
        }
      }
    };
    void create().then(result => {
      created = LocalAppPreviewSessionSchema.parse(result.session);
      if (created.appId !== appId || created.sourceHash !== sourceHash || created.mode !== mode) throw new Error('Preview authorization does not match the requested draft');
      if (!active) { void remove(created.id); return; }
      setSession({ ...created, hostBaseUrl: gatewayUrl, hostNamespace: namespace, hostRunKey: runKey, hostScopes: resourceScopes, hostScenario: scenarioId });
    }).catch(cause => { if (active) failure.current(cause); });
    return () => { window.removeEventListener('pagehide', dispose); dispose(); };
  }, [appId, sourceHash, mode, resourceScopes, scenarioId, runKey, gatewayUrl, namespace]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!session || !iframe) return;
    const router = new ExtensionMessageRouter(); registerBuiltinMethods(router); routerRef.current = router;
    router.registerIframe(session.extensionId, iframe, session.permissions, session.sourceHash, session.id, true, session.id);
    const detach = attachLocalAppPreviewChannel(iframe, value => {
      if (!value || typeof value !== 'object') return;
      if ('runId' in value && value.runId !== session.id) return;
      callback.current({ ...value, sourceHash: session.sourceHash });
    }, { runId: session.id,
      beforeRun: async () => {
        router.sendInit(session.extensionId, buildThemeInfo(useThemeStore.getState().resolved), useLocaleStore.getState().language);
        await router.whenIdle(session.extensionId);
      },
      onError: cause => failure.current(cause),
    });
    return () => { detach(); router.dispose(); routerRef.current = null; };
  }, [session]);

  useEffect(() => {
    if (session) routerRef.current?.sendEvent(session.extensionId, 'theme.changed', buildThemeInfo(theme));
  }, [session, theme]);

  const src = session ? `${apiUrl(session.previewUrl)}${session.previewUrl.includes('?') ? '&' : '?'}xopcHostRun=1&xopcPreviewMode=${session.mode}${scenarioId ? `&xopcAcceptance=1&xopcScenario=${encodeURIComponent(scenarioId)}` : ''}` : '';
  if (error && !hidden) return <p role="alert" className="p-4 text-sm text-danger">{error}</p>;
  if (!session) return hidden ? null : <Skeleton className="min-h-0 w-full flex-1" />;
  return <iframe ref={iframeRef} key={session.id} title={title} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer"
    aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined} lang={language}
    className={hidden ? 'pointer-events-none fixed left-[-200vw] top-0 h-[720px] w-[1024px] opacity-0' : 'min-h-0 w-full flex-1 bg-white'}
    onError={() => failure.current(new Error('Preview document failed to load'))}
    onLoad={() => routerRef.current?.sendInit(session.extensionId, buildThemeInfo(useThemeStore.getState().resolved), language)} />;
}
