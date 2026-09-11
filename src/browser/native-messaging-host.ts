import os from 'node:os';

import { loadConfig } from '../config/loader.js';
import { browserEnrollmentPublicKeyThumbprint } from './enrollment.js';
import { BROWSER_EXTENSION_ID } from './extension-identity.js';
import { closeXopcDatabase, openXopcDatabase } from '../storage/sqlite/connection.js';
import { createDevicePairingSetup } from '../storage/sqlite/device-pairing-repository.js';
import {
  getGatewayIdentityPublicKeyRaw,
  getOrCreateGatewayIdentity,
} from '../storage/sqlite/gateway-identity-repository.js';

export { BROWSER_EXTENSION_ID, BROWSER_NATIVE_HOST_NAME } from './extension-identity.js';

export type BrowserNativeBootstrap = {
  type: 'bootstrap';
  extensionId: string;
  publicKeyJwk: unknown;
  publicKeyThumbprint: string;
  nonce: string;
};

export type BrowserNativeBootstrapResult = {
  ok: true;
  gatewayUrl: string;
  pairingLink: string;
  expiresAt: number;
};

function gatewayLoopbackUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function encodeNativeMessage(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function decodeNativeMessage(buffer: Buffer): unknown {
  if (buffer.length < 4) throw new Error('Native message header is incomplete');
  const length = buffer.readUInt32LE(0);
  if (length === 0 || length > 1024 * 1024 || buffer.length !== length + 4) {
    throw new Error('Native message length is invalid');
  }
  return JSON.parse(buffer.subarray(4).toString('utf8')) as unknown;
}

export function createBrowserNativeBootstrap(
  configPath: string,
  request: Omit<BrowserNativeBootstrap, 'type'>,
): BrowserNativeBootstrapResult {
  if (request.extensionId !== BROWSER_EXTENSION_ID) throw new Error('Browser extension identity is not trusted');
  if (!/^[A-Za-z0-9_-]{24,160}$/.test(request.nonce)) throw new Error('Browser enrollment nonce is invalid');
  const publicKeyThumbprint = browserEnrollmentPublicKeyThumbprint(request.publicKeyJwk);
  if (request.publicKeyThumbprint !== publicKeyThumbprint) throw new Error('Browser enrollment key does not match');
  const config = loadConfig(configPath);
  const gatewayUrl = gatewayLoopbackUrl(config.gateway.port ?? 18790);
  openXopcDatabase();
  try {
    const route = { id: 'local-browser', kind: 'local-browser' as const, url: gatewayUrl };
    const setup = createDevicePairingSetup([route], Date.now(), 3, {
      ttlMs: 60_000,
      enrollment: {
        issuer: 'browser-native-host',
        extensionId: request.extensionId,
        publicKeyThumbprint,
        nonce: request.nonce,
      },
    });
    const identity = getOrCreateGatewayIdentity();
    const encoded = Buffer.from(JSON.stringify({
      version: 3,
      pairingToken: setup.token,
      gatewayId: identity.id,
      gatewayName: os.hostname(),
      gatewayPublicKey: getGatewayIdentityPublicKeyRaw(identity),
      routes: [route],
      expiresAt: setup.expiresAt,
    })).toString('base64url');
    return {
      ok: true,
      gatewayUrl,
      pairingLink: `https://link.xopc.ai/connect#p=${encoded}`,
      expiresAt: setup.expiresAt,
    };
  } finally {
    closeXopcDatabase();
  }
}

async function readOneNativeMessage(input: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    let expectedLength: number | undefined;
    const cleanup = () => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('error', onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('Native messaging input ended before one complete request'));
    };
    const onData = (chunk: string | Buffer) => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      if (expectedLength === undefined && buffered.length >= 4) {
        expectedLength = buffered.readUInt32LE(0);
        if (expectedLength === 0 || expectedLength > 1024 * 1024) {
          cleanup();
          reject(new Error('Native message length is invalid'));
          return;
        }
      }
      if (expectedLength !== undefined && buffered.length >= expectedLength + 4) {
        cleanup();
        input.pause();
        resolve(buffered.subarray(0, expectedLength + 4));
      }
    };
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
  });
}

export async function runBrowserNativeMessagingHost(configPath: string): Promise<void> {
  try {
    const request = decodeNativeMessage(await readOneNativeMessage(process.stdin));
    if (!request || typeof request !== 'object' || (request as { type?: unknown }).type !== 'bootstrap') {
      throw new Error('Unsupported native messaging request');
    }
    const bootstrap = request as BrowserNativeBootstrap;
    process.stdout.write(encodeNativeMessage(createBrowserNativeBootstrap(configPath, {
      extensionId: bootstrap.extensionId,
      publicKeyJwk: bootstrap.publicKeyJwk,
      publicKeyThumbprint: bootstrap.publicKeyThumbprint,
      nonce: bootstrap.nonce,
    })));
  } catch (error) {
    process.stdout.write(encodeNativeMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
