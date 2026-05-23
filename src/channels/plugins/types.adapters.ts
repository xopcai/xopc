/**
 * Additional channel adapter contracts (optional surfaces).
 */

import type { Config } from '../../config/index.js';
import type { BindingRule } from '../../routing/bindings.js';
import type { SessionStore } from '../../session/store.js';
import type { PairingPendingView } from '../pairing/pairing-service.js';

export interface ChannelPairingAdapter {
  /** Credential-store channel key (`telegram` | `feishu` | `weixin`). */
  pairingChannel: 'telegram' | 'feishu' | 'weixin';
  listPending(params: { cfg: Config; accountId?: string }): PairingPendingView[];
  approveByCode(params: {
    cfg: Config;
    accountId?: string;
    code: string;
  }): { ok: true; senderId: string } | { ok: false; error: string };
  approveBySenderId(params: {
    cfg: Config;
    accountId?: string;
    senderId: string;
  }): { ok: true; senderId: string } | { ok: false; error: string };
  revokePaired(params: {
    cfg: Config;
    accountId?: string;
    senderId: string;
  }): { ok: true; changed: boolean } | { ok: false; error: string };
}

export interface ChannelAllowlistAdapter {
  resolveAllowFromIds?(params: { cfg: Config; accountId?: string }): Array<string | number>;
}

export interface ChannelThreadingAdapter {
  resolveAutoThreadId?(params: { to: string; replyToId?: string }): string | undefined;
  topLevelReplyToMode?: string;
}

export interface ChannelLifecycleAdapter {
  onBeforeStart?(ctx: { cfg: Config; accountId: string }): Promise<void>;
  onAfterStart?(ctx: { cfg: Config; accountId: string }): Promise<void>;
  onBeforeStop?(ctx: { cfg: Config; accountId: string }): Promise<void>;
  onAfterStop?(ctx: { cfg: Config; accountId: string }): Promise<void>;
}

export interface ChannelHeartbeatAdapter {
  intervalMs: number;
  check(ctx: { cfg: Config; accountId: string }): Promise<{ healthy: boolean; details?: string }>;
}

export interface ChannelConfiguredBindingProvider {
  resolveBindings(cfg: Config, accountId?: string): BindingRule[];
}

export interface ChannelMessagingAdapter {
  routeInbound?(params: { cfg: Config; raw: unknown }): Promise<void>;
}

export interface ChannelDirectoryAdapter {
  resolveDisplayName?(params: { cfg: Config; id: string }): Promise<string | undefined>;
}

export interface ChannelResolverAdapter {
  resolvePeer?(params: { cfg: Config; handle: string }): Promise<{ id: string } | undefined>;
}

export interface ChannelAuthAdapter {
  ensureSession?(params: { cfg: Config; accountId: string }): Promise<void>;
}

export interface ChannelElevatedAdapter {
  isElevated?(params: { cfg: Config; senderId: string }): boolean;
}

export interface ChannelExecApprovalAdapter {
  requestApproval?(params: { cfg: Config; payload: unknown }): Promise<boolean>;
}

export interface ChannelAgentPromptAdapter {
  augmentSystemPrompt?(params: { cfg: Config; accountId?: string }): string | undefined;
}

/**
 * Resolves a cron job `delivery.to` string into a normalized chat target for outbound.
 */
export interface ChannelCronDeliveryAdapter {
  normalizeDeliveryTarget(
    to: string,
    sessionStore?: SessionStore,
  ): Promise<{ chatId: string; accountId?: string; metadata?: Record<string, unknown> }>;
}

/** CLI `xopc channels login --channel` for channels that support interactive login. */
export interface ChannelCliLoginAdapter {
  runLogin(params: {
    configPath: string;
    verbose?: boolean;
    timeoutMs?: number;
    accountId?: string;
    writeConfig?: boolean;
  }): Promise<{ ok: boolean; message?: string; accountId?: string; cancelled?: boolean }>;
}

/** Snapshot of channel-specific settings for gateway `/api/config` (implementations should redact secrets). */
export interface ChannelConfigSurfaceAdapter {
  buildConfigSurface(cfg: Config): Record<string, unknown>;
}

/** Interactive onboarding entry for a channel (alternative to declarative {@link ChannelSetupWizard}). */
export interface ChannelOnboardAdapter {
  isConfigured(config: Config): boolean;
  configure(config: Config): Promise<Config>;
}

export interface SetupStatus {
  ok: boolean;
  detail?: string;
}

export interface ChannelSetupWizard {
  channel: string;
  status?: {
    check(cfg: Config, accountId?: string): Promise<SetupStatus>;
  };
  envShortcut?: {
    envVar: string;
    configPath: string;
  };
  credentials: Array<{
    key: string;
    label: string;
    type: 'text' | 'password';
    validate?: (value: string) => string | null;
    hint?: string;
  }>;
  dmPolicy?: {
    options: Array<{ value: string; label: string; description: string }>;
    default: string;
  };
  allowFrom?: {
    hint: string;
    format: string;
  };
  finalize?: {
    validate(cfg: Config): Promise<{ ok: boolean; error?: string }>;
    message: string;
  };
}
