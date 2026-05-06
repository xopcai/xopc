import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelDoctorAdapter, ChannelDoctorCheckResult } from '@xopcai/xopc/channels/plugin-types.js';

import { resolveDingtalkAccount } from '../accounts.js';

export function createDingtalkDoctorAdapter(): ChannelDoctorAdapter {
  return {
    async check({ cfg }): Promise<ChannelDoctorCheckResult[]> {
      const account = resolveDingtalkAccount(cfg, 'default');
      if (!account.configured) {
        return [
          {
            id: 'dingtalk.credentials',
            label: 'DingTalk credentials',
            status: 'skip',
            message: 'channels.dingtalk not configured',
            hints: ['Run: xopc channels login --channel dingtalk', 'Or use Gateway Settings → Channels → DingTalk QR setup'],
          },
        ];
      }
      return [
        {
          id: 'dingtalk.credentials',
          label: 'DingTalk credentials',
          status: 'pass',
          message: 'Client ID and secret are present',
          hints: [],
        },
      ];
    },
  };
}
