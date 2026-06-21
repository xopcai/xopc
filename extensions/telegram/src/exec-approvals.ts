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
        accounts?: Record<
          string,
          {
            execApprovals?: { approvers?: Array<string | number> };
            allowFrom?: Array<string | number>;
          }
        >;
      }
    | undefined;
  const acc = tg?.accounts?.[accountId];
  const explicit = acc?.execApprovals?.approvers ?? [];
  const fallback = acc?.allowFrom ?? [];
  const merged = explicit.length > 0 ? explicit : fallback;
  return merged
    .map((v) => String(v).trim())
    .filter((v) => v && v !== '*' && /^\d+$/.test(v.replace(/^(telegram|tg):/i, '')))
    .map((v) => v.replace(/^(telegram|tg):/i, ''));
}

export function isTelegramExecApprovalApprover(params: {
  cfg: Config;
  accountId: string;
  senderId: string;
}): boolean {
  const approvers = resolveTelegramExecApprovers(params.cfg, params.accountId);
  const sid = params.senderId.replace(/^(telegram|tg):/i, '');
  return approvers.includes(sid);
}
