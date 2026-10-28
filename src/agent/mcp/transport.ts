import { lookup } from 'node:dns';
import { resolve } from 'node:path';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioTransport, StreamableHttpTransport, type AuthProvider, type JsonRpcMessage, type McpTransport, type McpTransportSendOptions } from '@earendil-works/pi-mcp';
import type { McpTransportFactory } from '@earendil-works/pi-coding-agent';
import { Agent, fetch as safeFetch } from 'undici';

import { checkUrlSafety } from '../tools/url-safety.js';

export type McpObservation = { method: string; stage: string; status: number; contentType: string; retryAt?: number; challenge?: string };
export type McpTransportDiagnostics = { observe?: (value: McpObservation) => void; beforeRequest?: (request?: { method: string; stage: string }) => void; probe?: boolean };
export function retryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return;
  const at = /^\d+(?:\.\d+)?$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(at) ? Math.max(now, at) : undefined;
}

// This supervisor relays stdio only; pi continues to own JSON-RPC and the MCP session.
const supervisor = `
import {spawn} from 'node:child_process';
const p=JSON.parse(process.argv[1]);
const child=spawn(p.command,p.args,{cwd:p.cwd,env:process.env,detached:process.platform!=='win32',stdio:['pipe','pipe','ignore'],windowsHide:true});
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;try{if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else process.kill(-child.pid,'SIGTERM');}catch{}setTimeout(()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');}catch{}process.exit(0);},500);};
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdin.on('end',stop);process.stdin.on('error',stop);
child.on('error',()=>{process.stderr.write('Local MCP executable could not start');process.exit(1);});
child.on('exit',code=>{stop();process.exitCode=code||0;});
process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});child.stdout.pipe(process.stdout);
`;

/** Adapts native transports; credentials are already resolved by prepareNativeMcpConfig. */
export function createXopcMcpTransport(diagnostics: McpTransportDiagnostics = {}): McpTransportFactory {
  return (entry, cwd, authProvider) => {
    const config = entry.config as unknown as Record<string, unknown>;
    if (!('url' in config)) {
      const env = Object.fromEntries(Object.entries(config.env as Record<string, string> ?? {}));
      const command = String(config.command), args = config.args as string[] | undefined, directory = resolve(cwd, String(config.cwd ?? '.'));
      if (!config.xopcManagedStdio) return new StdioTransport({ command, args, cwd: directory, env, stderr: 'pipe' });
      const inherited = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'SystemRoot', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
      return new StdioTransport({ command: process.execPath, args: ['--input-type=module', '-e', supervisor, JSON.stringify({ command, args: args ?? [], cwd: directory })],
        cwd: directory, env: { ...inherited, NPM_CONFIG_USERCONFIG: process.platform === 'win32' ? 'NUL' : '/dev/null', ...env }, inheritEnv: false, stderr: 'pipe', closeTimeoutMs: 2000 });
    }
    const url = new URL(String(config.url));
    const headers = config.headers as Record<string, string> | undefined;
    const dispatcher = new Agent({ connect: { lookup(host, options, callback) {
      lookup(host, { all: true }, (error, addresses) => {
        if (error) { callback(error, '', 4); return; }
        const local = !config.xopcPublicOnly && host === url.hostname;
        if (!local && addresses.some(a => !checkUrlSafety(`http://${a.family === 6 ? `[${a.address}]` : a.address}`).safe)) { callback(new Error('MCP destination resolved to a non-public address'), '', 4); return; }
        if (options.all) callback(null, addresses); else if (addresses[0]) callback(null, addresses[0].address, addresses[0].family); else callback(new Error('MCP destination has no address'), '', 4);
      });
    } } });
    const fetcher = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      let stage = method === 'GET' ? 'stream' : 'request';
      try { if (typeof init?.body === 'string') stage = JSON.parse(init.body).method ?? stage; } catch { /* Non-JSON OAuth bodies have no MCP method. */ }
      diagnostics.beforeRequest?.({ method, stage });
      const target = new URL(input);
      if (target.origin !== url.origin && !checkUrlSafety(target.href).safe || config.xopcPublicOnly && !checkUrlSafety(target.href).safe) throw new Error('MCP network policy refused this destination');
      const response = await safeFetch(input, { ...init, redirect: 'error', dispatcher } as Parameters<typeof safeFetch>[1]) as unknown as Response;
      const media = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
      diagnostics.observe?.({ method, stage, status: response.status, contentType: ['application/json', 'text/event-stream', 'text/html'].includes(media) ? media : 'unknown', retryAt: retryAfter(response.headers.get('retry-after')), challenge: response.headers.get('www-authenticate') ?? undefined });
      return response;
    };
    let transport: McpTransport;
    if (config.xopcLegacySse) transport = legacySse(url, headers, authProvider, fetcher);
    else transport = new StreamableHttpTransport({ url, headers, authProvider, fetch: fetcher, openGetStream: !diagnostics.probe, reconnect: diagnostics.probe ? { maxRetries: 0 } : undefined });
    const close = transport.close.bind(transport);
    transport.close = async () => { try { await close(); } finally { await dispatcher.close(); } };
    return transport;
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
