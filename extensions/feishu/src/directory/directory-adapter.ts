import type { ChannelDirectoryAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

import { resolveFeishuAccount } from '../state/accounts.js';

export function createFeishuDirectoryAdapter(): ChannelDirectoryAdapter {
  return {
    resolveDisplayName: async (params: { cfg: Config; id: string }) => {
      const id = params.id.trim();
      if (!id) return undefined;

      // Best-effort: if this looks like an open_id, try resolve user name.
      if (!id.startsWith('ou_') && !id.startsWith('on_')) {
        return undefined;
      }

      // Use default account for directory lookups for now.
      const account = resolveFeishuAccount(params.cfg, 'default');
      if (!account.configured) return undefined;

      const { createFeishuClient } = await import('../transport/client/client.js');
      const { api } = createFeishuClient(account);
      try {
        const res = await (api as any).contact.user.get({
          path: { user_id: id },
          params: { user_id_type: 'open_id' },
        });
        const name = res?.data?.user?.name ?? res?.data?.name;
        return typeof name === 'string' && name.trim() ? name.trim() : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

