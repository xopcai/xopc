import type { Config } from '@xopcai/xopc/config/index.js';
import type { ExecApprovalHandler, ExecApprovalRequestPayload } from '@xopcai/xopc/channels/exec-approval-runtime.js';
import type { TelegramAccountManager } from './account-manager.js';
import {
  createTelegramPendingApproval,
  waitForTelegramApproval,
} from './approval-store.js';
import { deliverTelegramExecApprovalPrompt } from './approval-delivery.js';
import { isTelegramExecApprovalEnabled, resolveTelegramExecApprovers } from './exec-approvals.js';

export function createTelegramExecApprovalHandler(deps: {
  accountManager: TelegramAccountManager;
  getConfig: () => Config;
}): ExecApprovalHandler {
  return {
    isEnabled(cfg, params) {
      if (params.channel !== 'telegram') return false;
      return isTelegramExecApprovalEnabled(cfg, params.accountId ?? 'default');
    },

    async requestApproval(cfg, payload: ExecApprovalRequestPayload): Promise<boolean> {
      const accountId = payload.accountId ?? 'default';
      const approvers = resolveTelegramExecApprovers(cfg, accountId);
      if (approvers.length === 0) {
        return false;
      }

      const bot = deps.accountManager.getBot(accountId);
      if (!bot) {
        return false;
      }

      const approval = createTelegramPendingApproval({
        accountId,
        sessionKey: payload.sessionKey,
        chatId: payload.chatId,
        toolName: payload.toolName,
        summary: payload.summary,
      });

      await deliverTelegramExecApprovalPrompt({ bot, cfg: deps.getConfig(), accountId, approval });
      return waitForTelegramApproval(approval.id);
    },
  };
}
