/**
 * Channel exec-approval gate — plugins register handlers; agent runtime invokes before risky tools.
 */

import type { Config } from '../config/schema.js';

export interface ExecApprovalRequestPayload {
  conversationId: string;
  channel: string;
  chatId: string;
  accountId?: string;
  toolName: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface ExecApprovalHandler {
  isEnabled(cfg: Config, params: { channel: string; accountId?: string }): boolean;
  requestApproval(cfg: Config, payload: ExecApprovalRequestPayload): Promise<boolean>;
  approvalRecipients?(cfg: Config, params: { accountId?: string }): string[];
}

const handlers = new Map<string, ExecApprovalHandler>();

export function registerChannelExecApprovalHandler(channelId: string, handler: ExecApprovalHandler): () => void {
  handlers.set(channelId, handler);
  return () => handlers.delete(channelId);
}

export async function maybeRequestChannelExecApproval(params: {
  cfg: Config;
  payload: ExecApprovalRequestPayload;
}): Promise<{ required: boolean; approved: boolean; reason?: string }> {
  const handler = handlers.get(params.payload.channel);
  if (!handler) {
    return { required: false, approved: true };
  }
  if (!handler.isEnabled(params.cfg, { channel: params.payload.channel, accountId: params.payload.accountId })) {
    return { required: false, approved: true };
  }
  const approved = await handler.requestApproval(params.cfg, params.payload);
  return {
    required: true,
    approved,
    reason: approved ? undefined : 'Exec approval denied or timed out',
  };
}

/** Existing channel confirmation floors feed the shared durable approval gate. */
export function channelExecApprovalRequired(cfg: Config, channel: string, accountId?: string): boolean {
  return handlers.get(channel)?.isEnabled(cfg, { channel, accountId }) ?? false;
}

export function channelApprovalRecipients(cfg: Config, channel: string, accountId?: string): string[] {
  return handlers.get(channel)?.approvalRecipients?.(cfg, { accountId }) ?? [];
}
