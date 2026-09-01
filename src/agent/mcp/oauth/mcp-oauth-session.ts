import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import type { McpOAuthSessionSnapshot, McpOAuthSessionStatus } from './mcp-oauth-types.js';

const CALLBACK_PATH = '/oauth/callback';
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

function callbackPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}

export class McpOAuthSession {
  readonly id = `mcp_oauth_${randomUUID()}`;
  readonly state = randomBytes(24).toString('base64url');
  readonly createdAt = Date.now();
  readonly expiresAt: number;
  private statusValue: McpOAuthSessionStatus = 'starting';
  private authorizationUrlValue?: string;
  private errorValue?: string;
  private callbackServer?: Server;
  private redirectUrlValue?: URL;
  private settleCode?: (result: { code?: string; error?: Error }) => void;
  private callbackConsumed = false;
  private readonly codePromise: Promise<{ code?: string; error?: Error }>;
  private timeout?: ReturnType<typeof setTimeout>;

  constructor(
    readonly serverId: string,
    readonly serverUrl: URL,
    ttlMs = DEFAULT_SESSION_TTL_MS,
  ) {
    this.expiresAt = this.createdAt + ttlMs;
    this.codePromise = new Promise((resolve) => {
      this.settleCode = resolve;
    });
  }

  get redirectUrl(): URL {
    if (!this.redirectUrlValue) throw new Error('MCP OAuth callback server has not started');
    return this.redirectUrlValue;
  }

  async start(): Promise<void> {
    if (this.callbackServer) return;
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('referrer-policy', 'no-referrer');
      response.setHeader('x-content-type-options', 'nosniff');
      try {
        const callback = new URL(request.url ?? '', 'http://127.0.0.1');
        if (callback.pathname !== CALLBACK_PATH) {
          response.statusCode = 404;
          response.end(callbackPage('Not found', 'This is not an XOPC OAuth callback.'));
          return;
        }
        if (callback.searchParams.get('state') !== this.state) {
          response.statusCode = 400;
          response.end(callbackPage('Authorization failed', 'MCP OAuth state mismatch'));
          return;
        }
        if (this.callbackConsumed) {
          response.statusCode = 409;
          response.end(callbackPage('Authorization already handled', 'Return to XOPC to continue.'));
          return;
        }
        const oauthError = callback.searchParams.get('error');
        const code = callback.searchParams.get('code');
        if (oauthError || !code) {
          const error = new Error(oauthError === 'access_denied' ? 'Authorization was denied' : 'Authorization code is missing');
          response.statusCode = 400;
          response.end(callbackPage('Authorization failed', error.message));
          this.fail(error);
          return;
        }
        this.callbackConsumed = true;
        this.statusValue = 'exchanging_code';
        response.statusCode = 200;
        response.end(callbackPage('Authorization complete', 'Return to XOPC to finish connecting the MCP server.'));
        this.settleCode?.({ code });
        this.settleCode = undefined;
      } catch {
        const error = new Error('MCP OAuth callback could not be processed');
        response.statusCode = 500;
        response.end(callbackPage('Authorization failed', error.message));
        this.fail(error);
      }
    });
    this.callbackServer = server;
    try {
      this.redirectUrlValue = await new Promise<URL>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('MCP OAuth callback server did not expose a TCP port'));
            return;
          }
          resolve(new URL(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`));
        });
      });
    } catch (error) {
      this.callbackServer = undefined;
      server.close();
      throw error;
    }
    this.timeout = setTimeout(() => {
      this.statusValue = 'expired';
      this.errorValue = 'MCP OAuth session expired';
      this.settleCode?.({ error: new Error(this.errorValue) });
      this.settleCode = undefined;
      void this.closeServer();
    }, Math.max(1, this.expiresAt - Date.now()));
    this.timeout.unref?.();
  }

  setAuthorizationUrl(url: URL): void {
    this.authorizationUrlValue = url.toString();
    this.statusValue = 'waiting_browser';
  }

  async waitForCode(): Promise<string> {
    const result = await this.codePromise;
    if (result.error) throw result.error;
    if (!result.code) throw new Error('MCP OAuth authorization code is unavailable');
    return result.code;
  }

  complete(): void {
    this.statusValue = 'connected';
    this.errorValue = undefined;
    void this.closeServer();
  }

  fail(error: unknown): void {
    this.statusValue = 'failed';
    this.errorValue = error instanceof Error ? error.message : String(error);
    this.settleCode?.({ error: error instanceof Error ? error : new Error(String(error)) });
    this.settleCode = undefined;
    void this.closeServer();
  }

  cancel(): void {
    if (['connected', 'failed', 'expired', 'cancelled'].includes(this.statusValue)) return;
    this.statusValue = 'cancelled';
    this.settleCode?.({ error: new Error('MCP OAuth session cancelled') });
    this.settleCode = undefined;
    void this.closeServer();
  }

  snapshot(): McpOAuthSessionSnapshot {
    return {
      id: this.id,
      serverId: this.serverId,
      serverUrl: this.serverUrl.toString(),
      status: this.statusValue,
      authorizationUrl: this.authorizationUrlValue,
      error: this.errorValue,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
    };
  }

  async close(): Promise<void> {
    this.cancel();
    await this.closeServer();
  }

  private async closeServer(): Promise<void> {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    const server = this.callbackServer;
    this.callbackServer = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
