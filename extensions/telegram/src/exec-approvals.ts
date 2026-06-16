/**
 * Native exec approval routing — scaffold for OpenClaw parity (Phase 5).
 * Wire to gateway approval store + callback_query handlers.
 */

import type { Config } from '@xopcai/xopc/config/index.js';

export function isTelegramExecApprovalEnabled(cfg: Config, accountId = 'default'): boolean {
  const tg = cfg.channels?.telegram as
    | { accounts?: Record<string, { execApprovals?: { enabled?: boolean } }> }
    | undefined;
  const acc = tg?.accounts?.[accountId];
  return acc?.execApprovals?.enabled === true;
}

export function resolveTelegramExecApprovers(
  cfg: Config,
  accountId = 'default',
): string[] {
  const tg = cfg.channels?.telegram as
    | {
        allowFrom?: Array<string | number>;
        accounts?: Record<string, { execApprovals?: { approvers?: Array<string | number> }; allowFrom?: Array<string | number> }>;
      }
    | undefined;
  const acc = tg?.accounts?.[accountId];
  const approvers = acc?.execApprovals?.approvers ?? acc?.allowFrom ?? tg?.allowFrom ?? [];
  return approvers.map((a) => String(a));
}
