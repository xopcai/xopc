import crypto from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  EXECUTION_HOST_PROTOCOL_VERSION,
  executionHostHelloSigningPayload,
  executionHostRegistrationSchema,
  executionHostTicketSigningPayload,
  type ExecutionHostCapabilities,
  type ExecutionHostHelloPayload,
  type ExecutionHostRegistration,
  type ExecutionHostTicketRequest,
} from '@xopcai/realtime-protocol';

import { resolveStateDir } from '../config/paths-state.js';

export interface ExecutionHostIdentity {
  registration: ExecutionHostRegistration;
  privateKey: string;
}

export function resolveExecutionHostStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.XOPC_EXECUTION_HOST_STATE_DIR?.trim()
    || join(resolveStateDir(env), 'execution-host');
}

export function resolveExecutionHostIdentityPath(stateDir: string): string {
  return join(stateDir, 'identity.json');
}

export function createExecutionHostIdentity(input: {
  stateDir: string;
  displayName: string;
  appVersion: string;
  capabilities: ExecutionHostCapabilities;
  maxConcurrency: number;
}): ExecutionHostIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity: ExecutionHostIdentity = {
    registration: {
      hostId: crypto.randomUUID(),
      displayName: input.displayName,
      platform: process.platform,
      arch: process.arch,
      appVersion: input.appVersion,
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      capabilities: input.capabilities,
      maxConcurrency: input.maxConcurrency,
    },
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
  const path = resolveExecutionHostIdentityPath(input.stateDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  return identity;
}

export function loadExecutionHostIdentity(stateDir: string): ExecutionHostIdentity {
  const path = resolveExecutionHostIdentityPath(stateDir);
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error('Execution host identity must be a regular file');
  chmodSync(path, 0o600);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ExecutionHostIdentity>;
  const registration = executionHostRegistrationSchema.parse(parsed.registration);
  if (typeof parsed.privateKey !== 'string' || parsed.privateKey.length < 32) {
    throw new Error('Execution host identity private key is invalid');
  }
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(parsed.privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  const derivedPublicKey = crypto.createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .toString('base64url');
  if (derivedPublicKey !== registration.publicKey) {
    throw new Error('Execution host identity key pair does not match');
  }
  return { registration, privateKey: parsed.privateKey };
}

function sign(identity: ExecutionHostIdentity, payload: string): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(identity.privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  return crypto.sign(
    'sha256',
    Buffer.from(payload),
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
}

export function createExecutionHostTicketRequest(
  identity: ExecutionHostIdentity,
  now = Date.now(),
): ExecutionHostTicketRequest {
  const request: ExecutionHostTicketRequest = {
    hostId: identity.registration.hostId,
    nonce: crypto.randomBytes(18).toString('base64url'),
    signedAt: now,
    signature: 'pending',
  };
  request.signature = sign(identity, executionHostTicketSigningPayload(request));
  return request;
}

export function createExecutionHostHello(
  identity: ExecutionHostIdentity,
  now = Date.now(),
): ExecutionHostHelloPayload {
  const registration = identity.registration;
  const hello: ExecutionHostHelloPayload = {
    protocolVersion: EXECUTION_HOST_PROTOCOL_VERSION,
    hostId: registration.hostId,
    platform: registration.platform,
    arch: registration.arch,
    appVersion: registration.appVersion,
    capabilities: registration.capabilities,
    maxConcurrency: registration.maxConcurrency,
    nonce: crypto.randomBytes(18).toString('base64url'),
    signedAt: now,
    signature: 'pending',
  };
  hello.signature = sign(identity, executionHostHelloSigningPayload(hello));
  return hello;
}
