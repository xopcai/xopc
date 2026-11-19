import type { PluginMcpOrigin } from '../../extensions/agent-plugins/refresh-runtime-access.js';
import { lookup } from 'node:dns';
import { resolve } from 'node:path';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioTransport, StreamableHttpTransport, type AuthProvider, type JsonRpcMessage, type McpTransport, type McpTransportSendOptions } from '@earendil-works/pi-mcp';
import type { McpTransportFactory } from '@earendil-works/pi-coding-agent';
import { Agent, fetch as safeFetch } from 'undici';

import { mcpStdioSupervisor } from '../../process/mcp-stdio-supervisor.js';
import { isPrivateMcpIp, isPrivateMcpTarget, isPublicMcpIp, isPublicMcpTarget, mcpHostname } from './network-policy.js';

export type McpObservation = { method: string; stage: string; status: number; contentType: string; retryAt?: number; challenge?: string };
export type McpTransportDiagnostics = { observe?: (value: McpObservation) => void; beforeRequest?: (request?: { method: string; stage: string }) => void; probe?: boolean };
export function retryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return;
  const at = /^\d+(?:\.\d+)?$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(at) ? Math.max(now, at) : undefined;
}

/** Adapts native transports; credentials are already resolved by prepareNativeMcpConfig. */
export function createXopcMcpTransport(diagnostics: McpTransportDiagnostics = {}, assertPluginCallAccess?: (origin: PluginMcpOrigin) => Promise<void>): McpTransportFactory {
  return (entry, cwd, authProvider) => {
    const config = entry.config as unknown as Record<string, unknown>;
    const plugin = config.xopcPlugin as PluginMcpOrigin | undefined;
    const guard = (transport: McpTransport) => {
      if (plugin && assertPluginCallAccess) {
        const send = transport.send.bind(transport);
        transport.send = async (message, options) => {
          if ('method' in message && message.method === 'tools/call') {
            options?.signal?.throwIfAborted();
            await assertPluginCallAccess(plugin);
            options?.signal?.throwIfAborted();
          }
          return send(message, options);
        };
      }
      return transport;
    };
    if (!('url' in config)) {
      const env = Object.fromEntries(Object.entries(config.env as Record<string, string> ?? {}));
      const command = String(config.command), args = config.args as string[] | undefined, directory = resolve(cwd, String(config.cwd ?? '.'));
      if (!config.xopcManagedStdio) return guard(new StdioTransport({ command, args, cwd: directory, env, stderr: 'pipe' }));
      const inherited = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'SystemRoot', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
      return guard(new StdioTransport({ command: process.execPath, args: ['--input-type=module', '-e', mcpStdioSupervisor, JSON.stringify({ command, args: args ?? [], cwd: directory })],
        cwd: directory, env: { ...inherited, NPM_CONFIG_USERCONFIG: process.platform === 'win32' ? 'NUL' : '/dev/null', ...env }, inheritEnv: false, stderr: 'pipe', closeTimeoutMs: 2000 }));
    }
    const url = new URL(String(config.url));
    const headers = config.headers as Record<string, string> | undefined;
    const privateNetwork = config.xopcPrivateNetwork === true;
    const publicOnly = config.xopcPublicOnly === true;
    const makeDispatcher = (policy: 'private' | 'public' | 'legacy') => new Agent({ connect: { lookup(host, options, callback) {
      lookup(host, { all: true }, (error, addresses) => {
        if (error) { callback(error, '', 4); return; }
        const local = policy === 'legacy' && mcpHostname(host) === mcpHostname(url.hostname);
        const allowed = policy === 'private' ? isPrivateMcpIp : isPublicMcpIp;
        if (!local && addresses.some(address => !allowed(address.address))) {
          callback(new Error('MCP destination resolved outside its approved network'), '', 4); return;
        }
        if (options.all) callback(null, addresses); else if (addresses[0]) callback(null, addresses[0].address, addresses[0].family); else callback(new Error('MCP destination has no address'), '', 4);
      });
    } } });
    const dispatcher = makeDispatcher(privateNetwork ? 'private' : publicOnly ? 'public' : 'legacy');
    const externalDispatcher = privateNetwork ? makeDispatcher('public') : undefined;
    const fetcher = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      let stage = method === 'GET' ? 'stream' : 'request';
      try { if (typeof init?.body === 'string') stage = JSON.parse(init.body).method ?? stage; } catch { /* Non-JSON OAuth bodies have no MCP method. */ }
      diagnostics.beforeRequest?.({ method, stage });
      const target = new URL(input);
      const sameOrigin = target.origin === url.origin;
      const approved = privateNetwork && sameOrigin ? isPrivateMcpTarget(target)
        : !sameOrigin || publicOnly ? isPublicMcpTarget(target) && (!privateNetwork || target.protocol === 'https:')
        : true;
      if (!approved) throw new Error('MCP network policy refused this destination');
      const response = await safeFetch(input, { ...init, redirect: 'error',
        dispatcher: sameOrigin ? dispatcher : externalDispatcher ?? dispatcher } as Parameters<typeof safeFetch>[1]) as unknown as Response;
      const media = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
      diagnostics.observe?.({ method, stage, status: response.status, contentType: ['application/json', 'text/event-stream', 'text/html'].includes(media) ? media : 'unknown', retryAt: retryAfter(response.headers.get('retry-after')), challenge: response.headers.get('www-authenticate') ?? undefined });
      return response;
    };
    let transport: McpTransport;
    if (config.xopcLegacySse) transport = legacySse(url, headers, authProvider, fetcher);
    else transport = new StreamableHttpTransport({ url, headers, authProvider, fetch: fetcher, openGetStream: !diagnostics.probe, reconnect: diagnostics.probe ? { maxRetries: 0 } : undefined });
    const close = transport.close.bind(transport);
    transport.close = async () => { try { await close(); } finally { await Promise.all([dispatcher.close(), externalDispatcher?.close()]); } };
    return guard(transport);
  };
}

function legacySse(url: URL, headers: Record<string, string> | undefined, auth: AuthProvider | undefined,
  fetcher: (input: string | URL, init?: RequestInit) => Promise<Response>): McpTransport {
  const messages = new Set<(message: JsonRpcMessage) => void>(), errors = new Set<(error: Error) => void>(), closed = new Set<() => void>();
  const sdk = new SSEClientTransport(url, { requestInit: { headers, redirect: 'error' }, fetch: async (input, init) => {
    const send = async () => { const h = new Headers(init?.headers); const token = await auth?.token(); if (token) h.set('Authorization', `Bearer ${token}`); return fetcher(input, { ...init, headers: h }); };
    let response = await send();
    if (response.status === 401 && auth?.onUnauthorized) { await auth.onUnauthorized({ response: response.clone(), serverUrl: url, fetch: fetcher }); await response.body?.cancel(); response = await send(); }
    return response;
  } });
  sdk.onmessage = message => { for (const listener of messages) listener(message as JsonRpcMessage); };
  sdk.onerror = error => { for (const listener of errors) listener(error); };
  sdk.onclose = () => { for (const listener of closed) listener(); };
  const subscribe = <T>(set: Set<T>, value: T) => { set.add(value); return () => { set.delete(value); }; };
  return { start: () => sdk.start(), close: () => sdk.close(), setProtocolVersion: value => sdk.setProtocolVersion(value),
    send: async (message: JsonRpcMessage, options?: McpTransportSendOptions) => { options?.signal?.throwIfAborted(); await sdk.send(message as Parameters<typeof sdk.send>[0]); },
    onMessage: value => subscribe(messages, value), onError: value => subscribe(errors, value), onClose: value => subscribe(closed, value) };
}
