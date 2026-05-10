import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { appendAllowFromIdSync } from './allow-from-file.js';

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_PENDING_TTL_MS = 60 * 60 * 1000;
const PAIRING_PENDING_MAX = 3;

export type PairingRequest = {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
};

type PairingStoreFile = {
  version: 1;
  requests: PairingRequest[];
};

function randomCode(): string {
  let out = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    out += PAIRING_CODE_ALPHABET[idx]!;
  }
  return out;
}

function parseTs(iso: string | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function isExpired(entry: PairingRequest, nowMs: number): boolean {
  const t = parseTs(entry.createdAt);
  if (t == null) return true;
  return nowMs - t > PAIRING_PENDING_TTL_MS;
}

function pruneExpired(reqs: PairingRequest[], nowMs: number): PairingRequest[] {
  return reqs.filter((r) => !isExpired(r, nowMs));
}

function normalizeAccountId(accountId: string | undefined): string {
  return (accountId ?? 'default').trim().toLowerCase() || 'default';
}

function requestAccountId(entry: PairingRequest): string {
  const fromMeta = entry.meta?.accountId?.trim().toLowerCase();
  return fromMeta || 'default';
}

function readStore(filePath: string): PairingStoreFile {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, requests: [] };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PairingStoreFile;
    if (parsed && Array.isArray(parsed.requests)) {
      return { version: 1, requests: parsed.requests };
    }
  } catch {
    /* ignore */
  }
  return { version: 1, requests: [] };
}

function writeStore(filePath: string, store: PairingStoreFile): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
}

/**
 * Create or refresh a pending pairing request for `id` (e.g. Telegram user id).
 * Returns `created: true` when a new code was minted (caller should notify the user).
 */
export function upsertPairingRequestSync(params: {
  pairingFilePath: string;
  id: string;
  accountId: string;
  meta?: Record<string, string | undefined | null>;
}): { code: string; created: boolean } {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const id = String(params.id).trim();
  if (!id) return { code: '', created: false };

  const normalizedAccountId = normalizeAccountId(params.accountId);
  const metaClean =
    params.meta && typeof params.meta === 'object'
      ? Object.fromEntries(
          Object.entries(params.meta)
            .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : ''] as const)
            .filter(([, v]) => Boolean(v)),
        )
      : {};
  const meta: Record<string, string> = { ...metaClean, accountId: normalizedAccountId };

  let store = readStore(params.pairingFilePath);
  let reqs = pruneExpired(store.requests, nowMs);

  const idx = reqs.findIndex((r) => r.id === id && requestAccountId(r) === normalizedAccountId);
  const existingCodes = new Set(reqs.map((r) => r.code.toUpperCase()));

  if (idx >= 0) {
    const existing = reqs[idx]!;
    const code = existing.code || randomCode();
    reqs[idx] = {
      id,
      code,
      createdAt: existing.createdAt || now,
      lastSeenAt: now,
      meta: { ...existing.meta, ...meta },
    };
    writeStore(params.pairingFilePath, { version: 1, requests: reqs });
    return { code, created: false };
  }

  const forAccount = reqs.filter((r) => requestAccountId(r) === normalizedAccountId);
  if (forAccount.length >= PAIRING_PENDING_MAX) {
    writeStore(params.pairingFilePath, { version: 1, requests: reqs });
    return { code: '', created: false };
  }

  let code = randomCode();
  for (let attempt = 0; attempt < 50 && existingCodes.has(code.toUpperCase()); attempt++) {
    code = randomCode();
  }
  existingCodes.add(code.toUpperCase());

  reqs = [...reqs, { id, code, createdAt: now, lastSeenAt: now, meta }];
  writeStore(params.pairingFilePath, { version: 1, requests: reqs });
  return { code, created: true };
}

/**
 * Approve a pairing code: remove pending request and append sender id to allowFrom file.
 */
export function approvePairingCodeSync(params: {
  pairingFilePath: string;
  allowFromFilePath: string;
  code: string;
  /** When set, only requests tagged with this account id match. */
  accountId?: string;
}): { senderId: string } | null {
  const want = (params.code ?? '').trim().toUpperCase();
  if (!want) return null;
  const normalizedAccount = normalizeAccountId(params.accountId);

  let store = readStore(params.pairingFilePath);
  let reqs = pruneExpired(store.requests, Date.now());
  const idx = reqs.findIndex(
    (r) => r.code.toUpperCase() === want && requestAccountId(r) === normalizedAccount,
  );
  if (idx < 0) {
    writeStore(params.pairingFilePath, { version: 1, requests: reqs });
    return null;
  }
  const entry = reqs[idx]!;
  reqs.splice(idx, 1);
  writeStore(params.pairingFilePath, { version: 1, requests: reqs });

  appendAllowFromIdSync(params.allowFromFilePath, entry.id);
  return { senderId: entry.id };
}
