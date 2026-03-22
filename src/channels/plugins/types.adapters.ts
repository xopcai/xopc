/**
 * Additional channel adapter contracts (OpenClaw-style optional surfaces).
 */

import type { Config } from '../../config/index.js';
import type { BindingRule } from '../../routing/bindings.js';

export interface ChannelPairingAdapter {
  generatePairingCode(params: { cfg: Config; accountId?: string }): string;
  validatePairingCode(params: { cfg: Config; code: string; senderId: string }): boolean;
  completePairing(params: { cfg: Config; senderId: string; code: string }): Promise<void>;
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
