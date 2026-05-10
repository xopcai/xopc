import type { Config } from '@xopcai/xopc/config/schema.js';

import type { DingtalkConfig } from './config-schema.js';

export type DingtalkPolicyPatch = Partial<
  Pick<DingtalkConfig, 'dmPolicy' | 'groupPolicy' | 'allowFrom' | 'groupAllowFrom' | 'requireMention'>
>;

export function mergeDingtalkCredentialsIntoConfig(
  cfg: Config,
  creds: { clientId: string; clientSecret: string },
  policies?: DingtalkPolicyPatch,
): Config {
  const prev = (cfg.channels?.dingtalk ?? {}) as DingtalkConfig;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...prev,
        enabled: true,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        dmPolicy: policies?.dmPolicy ?? prev.dmPolicy ?? 'pairing',
        groupPolicy: policies?.groupPolicy ?? prev.groupPolicy ?? 'open',
        allowFrom: policies?.allowFrom ?? prev.allowFrom ?? [],
        groupAllowFrom: policies?.groupAllowFrom ?? prev.groupAllowFrom ?? [],
        requireMention: policies?.requireMention ?? prev.requireMention,
      },
    },
  };
}
