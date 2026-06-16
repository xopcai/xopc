import { randomUUID } from 'node:crypto';

export type TelegramApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface TelegramPendingApproval {
  id: string;
  accountId: string;
  sessionKey: string;
  chatId: string;
  toolName: string;
  summary: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: TelegramApprovalStatus;
  resolve?: (approved: boolean) => void;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, TelegramPendingApproval>();

export function createTelegramPendingApproval(params: {
  accountId: string;
  sessionKey: string;
  chatId: string;
  toolName: string;
  summary: string;
  ttlMs?: number;
}): TelegramPendingApproval {
  const id = randomUUID().slice(0, 8);
  const now = Date.now();
  const entry: TelegramPendingApproval = {
    id,
    accountId: params.accountId,
    sessionKey: params.sessionKey,
    chatId: params.chatId,
    toolName: params.toolName,
    summary: params.summary,
    createdAtMs: now,
    expiresAtMs: now + (params.ttlMs ?? DEFAULT_TTL_MS),
    status: 'pending',
  };
  pending.set(id, entry);
  return entry;
}

export function waitForTelegramApproval(id: string, timeoutMs = DEFAULT_TTL_MS): Promise<boolean> {
  const entry = pending.get(id);
  if (!entry || entry.status !== 'pending') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (entry.status === 'pending') {
        entry.status = 'expired';
        pending.delete(id);
      }
      resolve(false);
    }, timeoutMs);
    entry.resolve = (approved) => {
      clearTimeout(timer);
      resolve(approved);
    };
  });
}

export function resolveTelegramApproval(id: string, approved: boolean): boolean {
  const entry = pending.get(id);
  if (!entry || entry.status !== 'pending') {
    return false;
  }
  entry.status = approved ? 'approved' : 'denied';
  entry.resolve?.(approved);
  pending.delete(id);
  return true;
}

export function getTelegramPendingApproval(id: string): TelegramPendingApproval | undefined {
  return pending.get(id);
}

export function listTelegramPendingApprovals(): TelegramPendingApproval[] {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (entry.status === 'pending' && entry.expiresAtMs <= now) {
      entry.status = 'expired';
      pending.delete(id);
    }
  }
  return [...pending.values()].filter((e) => e.status === 'pending');
}
