import { buildDevicePairingProof, type DevicePairingAction, type DevicePairingStatus } from '@xopcai/gateway-contract';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { create } from 'zustand';

import {
  getOrCreateDevicePrivateKey, writeDeviceRefreshToken, readDeviceAuthJournal,
  writeDeviceAuthJournal, clearDeviceAuthJournal,
} from '../../storage/device-credentials';
import { useGatewayStore } from '../../stores/gateway-store';
import { parseGatewayProfile, type GatewayProfile } from '../../stores/gateway-types';
import { decodeBase64UrlJson, devicePublicKeyJwk, verifyGatewayPayload, randomNonce, signDevicePayload } from './device-crypto';
import { createDeviceRefreshToken, refreshCredentialsForProfile } from './device-auth-session';
import { parseGatewayQrPayload, type ParsedGatewayQr } from './parse-gateway-qr';

type PairingJournal = {
  pairing: ParsedGatewayQr; requestId: string; origin: string;
  device: { displayName: string; platform: 'ios' | 'android'; publicKeyJwk: ReturnType<typeof devicePublicKeyJwk> };
  idempotencyKey: string; initialRefreshToken: string; profile?: GatewayProfile; refreshInstalled?: boolean;
};
type PairingProgress = { stage: 'connecting' | 'approval' | 'completing'; name: string; confirmationCode?: string; expiresAt?: number };
export const useDevicePairingFlow = create<{ progress: PairingProgress | null; error: string | null }>(() => ({ progress: null, error: null }));
const JOURNAL = 'pairing';
let running: Promise<GatewayProfile> | null = null;
let flowController: AbortController | null = null;

function throwIfPairingPaused(signal?: AbortSignal): void {
  // React Native's AbortSignal does not implement throwIfAborted().
  if (signal?.aborted) throw new Error('PAIRING_PAUSED');
}

export function readPendingDevicePairing(): ParsedGatewayQr | null {
  return readDeviceAuthJournal<PairingJournal>(JOURNAL)?.pairing ?? null;
}

async function post(origin: string, path: string, body: unknown, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 8_000);
  try {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json() as { signedPayload?: string; signature?: string; error?: { code?: string } };
    if (!response.ok) throw new Error(data.error?.code ?? 'PAIRING_CONNECTION_FAILED');
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

async function signedRequest(journal: PairingJournal, action: DevicePairingAction, signal?: AbortSignal) {
  const body = {
    gatewayId: journal.pairing.gatewayId, requestId: journal.requestId, pairingToken: journal.pairing.pairingToken,
    timestamp: Date.now(), nonce: randomNonce(),
    ...(action === 'request' ? { device: journal.device } : {}),
    ...(action === 'complete' ? { idempotencyKey: journal.idempotencyKey, initialRefreshToken: journal.initialRefreshToken } : {}),
  };
  const signature = signDevicePayload(getOrCreateDevicePrivateKey(), buildDevicePairingProof(action, body));
  const path = action === 'request' ? '/api/device-pairing/requests' : `/api/device-pairing/requests/${journal.requestId}/${action}`;
  let response: Awaited<ReturnType<typeof post>> | undefined;
  const origins = [...new Set([journal.origin, ...journal.pairing.routes.map(route => route.url)])];
  for (const origin of origins) {
    try { response = await post(origin, path, { ...body, signature }, signal); journal.origin = origin; break; }
    catch (error) {
      throwIfPairingPaused(signal);
      if (error instanceof Error && error.message.startsWith('PAIRING_') && error.message !== 'PAIRING_CONNECTION_FAILED') throw error;
    }
  }
  if (!response) throw new Error('PAIRING_CONNECTION_FAILED');
  if (!response.signedPayload || !response.signature || !verifyGatewayPayload(journal.pairing.gatewayPublicKey, response.signedPayload, response.signature)) {
    throw new Error('PAIRING_IDENTITY_MISMATCH');
  }
  const result = decodeBase64UrlJson<{
    request: DevicePairingStatus; gateway: { id: string; name: string }; nonce: string;
    routes?: ParsedGatewayQr['routes']; scopes?: string[];
  }>(response.signedPayload);
  if (result.gateway.id !== journal.pairing.gatewayId || result.nonce !== body.nonce || result.request.requestId !== journal.requestId) {
    throw new Error('PAIRING_IDENTITY_MISMATCH');
  }
  writeDeviceAuthJournal(JOURNAL, journal);
  return result;
}

async function reachableOrigin(pairing: ParsedGatewayQr, signal?: AbortSignal): Promise<string> {
  const pairingId = pairing.pairingToken.slice('xopc_pair_'.length).split('_')[0];
  for (const route of pairing.routes) {
    throwIfPairingPaused(signal);
    try {
      const response = await post(route.url, '/api/device-pairing/probe', { pairingId }, signal);
      if (!response.signedPayload || !response.signature || !verifyGatewayPayload(pairing.gatewayPublicKey, response.signedPayload, response.signature)) {
        throw new Error('PAIRING_IDENTITY_MISMATCH');
      }
      const proof = decodeBase64UrlJson<{ gatewayId: string; pairingId: string; issuedAt: number }>(response.signedPayload);
      if (proof.gatewayId !== pairing.gatewayId || proof.pairingId !== pairingId || Math.abs(Date.now() - proof.issuedAt) > 300_000) {
        throw new Error('PAIRING_IDENTITY_MISMATCH');
      }
      return route.url;
    } catch (error) {
      throwIfPairingPaused(signal);
      if (error instanceof Error && error.message === 'PAIRING_IDENTITY_MISMATCH') throw error;
    }
  }
  throw new Error('PAIRING_CONNECTION_FAILED');
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('PAIRING_PAUSED')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('PAIRING_PAUSED')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 1500);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function pairWithGateway(pairing: ParsedGatewayQr, signal?: AbortSignal): Promise<GatewayProfile> {
  if (running) {
    const current = readPendingDevicePairing();
    if (current?.pairingToken !== pairing.pairingToken) throw new Error('PAIRING_ALREADY_PENDING');
    return running;
  }
  useDevicePairingFlow.setState({ error: null });
  flowController = new AbortController();
  const controller = flowController;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const parentSignal = signal;
  signal = controller.signal;
  running = (async () => {
    if (pairing.version !== 3) throw new Error('PAIRING_UPDATE_REQUIRED');
    useDevicePairingFlow.setState({ progress: { stage: 'connecting', name: pairing.gatewayName } });
    let journal = readDeviceAuthJournal<PairingJournal>(JOURNAL);
    if (journal && journal.pairing.pairingToken !== pairing.pairingToken) throw new Error('PAIRING_ALREADY_PENDING');
    if (!journal) {
      if (pairing.expiresAt <= Date.now()) throw new Error('PAIRING_EXPIRED');
      const origin = await reachableOrigin(pairing, signal);
      journal = {
        pairing, origin, requestId: randomUUID(), idempotencyKey: randomUUID(), initialRefreshToken: createDeviceRefreshToken(),
        device: { displayName: Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android'),
          platform: Platform.OS === 'ios' ? 'ios' : 'android', publicKeyJwk: devicePublicKeyJwk(getOrCreateDevicePrivateKey()) },
      };
      writeDeviceAuthJournal(JOURNAL, journal);
    }
    if (!journal.profile) {
      let result = await signedRequest(journal, 'request', signal);
      while (result.request.status === 'pending') {
        useDevicePairingFlow.setState({ progress: { stage: 'approval', name: pairing.gatewayName,
          confirmationCode: result.request.confirmationCode, expiresAt: result.request.expiresAt } });
        await waitForPoll(signal);
        result = await signedRequest(journal, 'status', signal);
      }
      if (!['approved', 'completed'].includes(result.request.status)) {
        clearDeviceAuthJournal(JOURNAL);
        throw new Error(`PAIRING_${result.request.status.toUpperCase()}`);
      }
      useDevicePairingFlow.setState({ progress: { stage: 'completing', name: pairing.gatewayName } });
      result = await signedRequest(journal, 'complete', signal);
      const profile = parseGatewayProfile({ gatewayId: pairing.gatewayId, name: result.gateway.name,
        gatewayPublicKey: pairing.gatewayPublicKey, deviceId: result.request.deviceId, scopes: result.scopes,
        routes: result.routes, activeRouteId: result.routes?.find(r => r.url === journal.origin)?.id, updatedAt: Date.now() });
      if (!profile) throw new Error('PAIRING_INVALID_RESPONSE');
      journal.profile = profile;
      writeDeviceAuthJournal(JOURNAL, journal);
    }
    throwIfPairingPaused(signal);
    if (!journal.refreshInstalled) {
      writeDeviceRefreshToken(pairing.gatewayId, journal.initialRefreshToken);
      journal.refreshInstalled = true;
      writeDeviceAuthJournal(JOURNAL, journal);
    }
    const tokens = await refreshCredentialsForProfile(journal.profile);
    throwIfPairingPaused(signal);
    useGatewayStore.getState().savePairedProfile(journal.profile, tokens.accessToken, tokens.accessTokenExpiresAt);
    clearDeviceAuthJournal(JOURNAL);
    useDevicePairingFlow.setState({ progress: null });
    return journal.profile;
  })();
  try { return await running; } catch (error) {
    if (!controller.signal.aborted) useDevicePairingFlow.setState({ error: error instanceof Error ? error.message : 'PAIRING_CONNECTION_FAILED' });
    throw error;
  } finally {
    parentSignal?.removeEventListener('abort', abort);
    useDevicePairingFlow.setState({ progress: null });
    running = null; flowController = null;
  }
}

export function pauseDevicePairing(): void { flowController?.abort(); }

export async function cancelPendingDevicePairing(): Promise<void> {
  flowController?.abort();
  if (running) await running.catch(() => {});
  const journal = readDeviceAuthJournal<PairingJournal>(JOURNAL);
  if (journal) {
    try { await signedRequest(journal, 'cancel'); }
    catch (error) {
      if (!(error instanceof Error) || !['PAIRING_EXPIRED', 'PAIRING_NOT_FOUND', 'PAIRING_CANCELLED', 'PAIRING_DENIED'].includes(error.message)) throw error;
    }
  }
  clearDeviceAuthJournal(JOURNAL);
  useDevicePairingFlow.setState({ progress: null, error: null });
}

export async function pairGatewayLink(link: string): Promise<GatewayProfile> {
  const pairing = parseGatewayQrPayload(link);
  if (!pairing) throw new Error('PAIRING_INVALID_LINK');
  return pairWithGateway(pairing);
}
