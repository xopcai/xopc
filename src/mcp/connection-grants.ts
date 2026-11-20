import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { resolveStateDir } from '../config/paths.js';

export const MCP_BRIDGE_PATH = '/api/mcp/bridge';
const ConnectionId = z.uuidv4();
const Grant = z.strictObject({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  capabilityIds: z.array(z.string()).min(1),
});
const tokenPattern = /^xopc_mcp_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function grantsDir(): string {
  return join(resolveStateDir(), 'mcp-connections');
}

export function createMcpConnection(capabilityIds: readonly string[]): { connectionId: string; token: string } {
  const connectionId = randomUUID();
  const token = `xopc_mcp_${connectionId}.${randomBytes(32).toString('base64url')}`;
  const grant = Grant.parse({ tokenHash: digest(token), capabilityIds: [...new Set(capabilityIds)] });
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

export function readMcpConnectionGrant(connectionId: string) {
  if (!ConnectionId.safeParse(connectionId).success) return null;
  try {
    return Grant.parse(JSON.parse(readFileSync(join(grantsDir(), `${connectionId}.json`), 'utf8')));
  } catch {
    return null;
  }
}

export function authenticateMcpConnection(token: string): { connectionId: string; capabilityIds: string[] } | null {
  const connectionId = tokenPattern.exec(token)?.[1];
  const grant = connectionId && readMcpConnectionGrant(connectionId);
  if (!connectionId || !grant || !timingSafeEqual(Buffer.from(grant.tokenHash, 'hex'), Buffer.from(digest(token), 'hex'))) return null;
  return { connectionId, capabilityIds: grant.capabilityIds };
}
