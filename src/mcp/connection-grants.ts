import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { resolveStateDir } from '../config/paths.js';
import { McpConnectionCallbackSchema, type McpConnectionCallback } from './callback-config.js';

export const MCP_BRIDGE_PATH = '/api/mcp/bridge';
const ConnectionId = z.uuidv4();

const Grant = z.strictObject({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  capabilityIds: z.array(z.string()).min(1),
  name: z.string().trim().min(1).max(120).optional(),
  toolset: z.string().trim().min(1).max(64).optional(),
  projectIds: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(50).optional(),
  callback: McpConnectionCallbackSchema.optional(),
  createdAt: z.number().int().nonnegative().optional(),
  expiresAt: z.number().int().positive().optional(),
});

export type McpConnectionGrant = z.infer<typeof Grant>;

export interface McpConnectionSummary {
  connectionId: string;
  capabilityIds: string[];
  name?: string;
  toolset?: string;
  projectIds?: string[];
  maxConcurrentRuns?: number;
  hasCallback: boolean;
  callbackUrl?: string;
  createdAt?: number;
  expiresAt?: number;
  expired: boolean;
}

export interface CreateMcpConnectionOptions {
  name?: string;
  toolset?: string;
  projectIds?: readonly string[];
  maxConcurrentRuns?: number;
  callback?: McpConnectionCallback;
  expiresAt?: number;
}

const tokenPattern = /^xopc_mcp_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function grantsDir(): string {
  return join(resolveStateDir(), 'mcp-connections');
}

export function createMcpConnection(
  capabilityIds: readonly string[],
  options: CreateMcpConnectionOptions = {},
): { connectionId: string; token: string } {
  const connectionId = randomUUID();
  const token = `xopc_mcp_${connectionId}.${randomBytes(32).toString('base64url')}`;
  const projectIds = options.projectIds?.length ? [...new Set(options.projectIds)] : undefined;
  const grant = Grant.parse({
    tokenHash: digest(token),
    capabilityIds: [...new Set(capabilityIds)],
    ...(options.name?.trim() ? { name: options.name.trim() } : {}),
    ...(options.toolset?.trim() ? { toolset: options.toolset.trim() } : {}),
    ...(projectIds ? { projectIds } : {}),
    ...(options.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: options.maxConcurrentRuns } : {}),
    ...(options.callback ? { callback: options.callback } : {}),
    createdAt: Date.now(),
    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
  });
  const dir = grantsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const draft = join(dir, `${connectionId}.tmp`);
  try {
    writeFileSync(draft, JSON.stringify(grant), { mode: 0o600, flag: 'wx' });
    renameSync(draft, join(dir, `${connectionId}.json`));
  } finally {
    rmSync(draft, { force: true });
  }
  return { connectionId, token };
}

export function revokeMcpConnection(connectionId: string): void {
  rmSync(join(grantsDir(), `${ConnectionId.parse(connectionId)}.json`), { force: true });
}

export function getMcpBearerToken(authorization: string | undefined): string {
  return /^Bearer (\S+)$/i.exec(authorization ?? '')?.[1] ?? '';
}

export function readMcpConnectionGrant(connectionId: string): McpConnectionGrant | null {
  if (!ConnectionId.safeParse(connectionId).success) return null;
  try {
    return Grant.parse(JSON.parse(readFileSync(join(grantsDir(), `${connectionId}.json`), 'utf8')));
  } catch {
    return null;
  }
}

export function isMcpGrantExpired(grant: { expiresAt?: number }, now = Date.now()): boolean {
  return grant.expiresAt !== undefined && grant.expiresAt <= now;
}

export function listMcpConnections(): McpConnectionSummary[] {
  const dir = grantsDir();
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const now = Date.now();
  const summaries: McpConnectionSummary[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const connectionId = file.slice(0, -'.json'.length);
    const grant = readMcpConnectionGrant(connectionId);
    if (!grant) continue;
    summaries.push({
      connectionId,
      capabilityIds: grant.capabilityIds,
      ...(grant.name ? { name: grant.name } : {}),
      ...(grant.toolset ? { toolset: grant.toolset } : {}),
      ...(grant.projectIds ? { projectIds: grant.projectIds } : {}),
      ...(grant.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: grant.maxConcurrentRuns } : {}),
      hasCallback: Boolean(grant.callback),
      ...(grant.callback ? { callbackUrl: grant.callback.url } : {}),
      ...(grant.createdAt !== undefined ? { createdAt: grant.createdAt } : {}),
      ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt } : {}),
      expired: isMcpGrantExpired(grant, now),
    });
  }
  return summaries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function authenticateMcpConnection(token: string): {
  connectionId: string;
  capabilityIds: string[];
  toolset?: string;
  projectIds?: string[];
  maxConcurrentRuns?: number;
  callback?: McpConnectionCallback;
} | null {
  const connectionId = tokenPattern.exec(token)?.[1];
  const grant = connectionId && readMcpConnectionGrant(connectionId);
  if (
    !connectionId
    || !grant
    || isMcpGrantExpired(grant)
    || !timingSafeEqual(Buffer.from(grant.tokenHash, 'hex'), Buffer.from(digest(token), 'hex'))
  ) {
    return null;
  }
  return {
    connectionId,
    capabilityIds: grant.capabilityIds,
    ...(grant.toolset?.startsWith('external-read-') ? { toolset: grant.toolset } : {}),
    ...(grant.projectIds ? { projectIds: grant.projectIds } : {}),
    ...(grant.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: grant.maxConcurrentRuns } : {}),
    ...(grant.callback ? { callback: grant.callback } : {}),
  };
}
