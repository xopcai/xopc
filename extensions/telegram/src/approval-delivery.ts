import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import type { TelegramPendingApproval } from './approval-store.js';
import { resolveTelegramExecApprovers } from './exec-approvals.js';
import type { Config } from '@xopcai/xopc/config/index.js';

const log = createLogger('TelegramApprovalDelivery');

export async function deliverTelegramExecApprovalPrompt(params: {
  bot: Bot;
  cfg: Config;
  accountId: string;
  approval: TelegramPendingApproval;
}): Promise<void> {
  const approvers = resolveTelegramExecApprovers(params.cfg, params.accountId);
  if (approvers.length === 0) {
    log.warn({ accountId: params.accountId }, 'No exec approvers configured');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('✅ Approve', `approval:approve:${params.approval.id}`)
    .text('❌ Deny', `approval:deny:${params.approval.id}`);

  const text = [
    '⚠️ Exec approval required',
    '',
    `Tool: ${params.approval.toolName}`,
    params.approval.summary,
    '',
    `ID: ${params.approval.id}`,
  ].join('\n');

  for (const approver of approvers) {
    try {
      await params.bot.api.sendMessage(approver, text, { reply_markup: keyboard });
    } catch (err) {
      log.warn({ err, approver, approvalId: params.approval.id }, 'Failed to send approval prompt');
    }
  }
}
