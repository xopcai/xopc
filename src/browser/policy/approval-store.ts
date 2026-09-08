import { createHash, randomUUID } from 'node:crypto';

import type { BrowserActionInput, BrowserRiskLevel } from '@xopcai/browser-control-contract';

export type BrowserApprovalStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';

export interface BrowserApproval {
  id: string;
  sessionKey: string;
  risk: BrowserRiskLevel;
  action: BrowserActionInput['action'];
  summary: string;
  argumentsHash: string;
  status: BrowserApprovalStatus;
  createdAt: string;
  expiresAt: string;
}

const TTL_MS = 10 * 60 * 1000;
const approvals = new Map<string, BrowserApproval>();

export function createBrowserApproval(
  sessionKey: string,
  input: BrowserActionInput,
  risk: BrowserRiskLevel,
  summary: string,
): BrowserApproval {
  expireApprovals();
  const argumentsHash = browserArgumentsHash(input);
  const existing = [...approvals.values()].find((approval) =>
    approval.sessionKey === sessionKey
    && approval.argumentsHash === argumentsHash
    && approval.status === 'pending',
  );
  if (existing) return existing;
  const now = Date.now();
  const approval: BrowserApproval = {
    id: randomUUID(),
    sessionKey,
    risk,
    action: input.action,
    summary,
    argumentsHash,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  approvals.set(approval.id, approval);
  return approval;
}

export function listBrowserApprovals(sessionKey?: string): BrowserApproval[] {
  expireApprovals();
  return [...approvals.values()]
    .filter((approval) => !sessionKey || approval.sessionKey === sessionKey)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function decideBrowserApproval(id: string, decision: 'approved' | 'denied'): BrowserApproval | undefined {
  expireApprovals();
  const approval = approvals.get(id);
  if (!approval || approval.status !== 'pending') return approval;
  approval.status = decision;
  return approval;
}

export function consumeBrowserApproval(
  id: string | undefined,
  sessionKey: string,
  input: BrowserActionInput,
): boolean {
  expireApprovals();
  const argumentsHash = browserArgumentsHash(input);
  const approval = id
    ? approvals.get(id)
    : [...approvals.values()].find((candidate) =>
      candidate.sessionKey === sessionKey
      && candidate.argumentsHash === argumentsHash
      && candidate.status === 'approved',
    );
  if (!approval || approval.status !== 'approved') return false;
  if (approval.sessionKey !== sessionKey || approval.argumentsHash !== argumentsHash) return false;
  approval.status = 'consumed';
  return true;
}

function browserArgumentsHash(input: BrowserActionInput): string {
  const canonical = { ...input, approvalId: undefined };
  return createHash('sha256').update(JSON.stringify(sortRecursively(canonical))).digest('hex');
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortRecursively(child)]),
  );
}

function expireApprovals(): void {
  const now = Date.now();
  for (const approval of approvals.values()) {
    if ((approval.status === 'pending' || approval.status === 'approved') && Date.parse(approval.expiresAt) <= now) {
      approval.status = 'expired';
    }
  }
}
