import type { ChannelDoctorAdapter, ChannelDoctorCheckResult } from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

import { listFeishuAccountIds, resolveFeishuAccount } from '../state/accounts.js';

function checkAccount(cfg: Config, accountId: string): ChannelDoctorCheckResult[] {
  const a = resolveFeishuAccount(cfg, accountId);
  const results: ChannelDoctorCheckResult[] = [];
  results.push({
    id: `feishu.${accountId}.configured`,
    label: `Feishu[${accountId}] credentials`,
    status: a.configured ? 'pass' : 'fail',
    message: a.configured ? 'Configured' : 'Missing appId/appSecret',
    hints: a.configured
      ? []
      : ['Set `channels.feishu.appId` and `channels.feishu.appSecret` (or per-account under `channels.feishu.accounts`).'],
  });
  results.push({
    id: `feishu.${accountId}.mode`,
    label: `Feishu[${accountId}] connection mode`,
    status: 'pass',
    message: `Mode: ${a.connectionMode}`,
    hints: [],
  });
  return results;
}

export function createFeishuDoctorAdapter(): ChannelDoctorAdapter {
  return {
    async check(params: { cfg: Config }) {
      const ids = listFeishuAccountIds(params.cfg);
      if (ids.length === 0) {
        return [
          {
            id: 'feishu.missing',
            label: 'Feishu config',
            status: 'skip',
            message: 'No channels.feishu config present',
            hints: ['Add `channels.feishu.enabled=true` to start the channel.'],
          },
        ];
      }
      return ids.flatMap((id) => checkAccount(params.cfg, id));
    },
  };
}

