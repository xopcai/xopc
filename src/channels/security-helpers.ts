/**
 * Helpers for building DM/security policy resolvers (OpenClaw-style).
 */

import type { Config } from '../config/index.js';

export function createScopedDmSecurityResolver<ResolvedAccount>(params: {
  channelKey: string;
  resolvePolicy: (account: ResolvedAccount) => string | undefined;
  resolveAllowFrom: (account: ResolvedAccount) => Array<string | number> | undefined;
  defaultPolicy?: string;
  normalizeEntry?: (raw: string) => string;
}) {
  return (ctx: { cfg: Config; accountId?: string; account: ResolvedAccount }) => {
    const policy = params.resolvePolicy(ctx.account) ?? params.defaultPolicy ?? 'pairing';
    const allowFrom = params.resolveAllowFrom(ctx.account) ?? [];

    return {
      policy,
      allowFrom: allowFrom.map(String),
      isAllowed: (senderId: string) => {
        if (policy === 'open') return true;
        if (policy === 'disabled') return false;
        const normalized = params.normalizeEntry
          ? params.normalizeEntry(senderId)
          : senderId;
        return allowFrom.some((entry) => String(entry) === normalized);
      },
    };
  };
}
