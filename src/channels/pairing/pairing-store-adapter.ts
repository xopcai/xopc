import type { Config } from '../../config/index.js';
import type { ChannelPairingAdapter } from '../plugins/types.adapters.js';

import type { PairingCliChannel } from './pairing-channel.js';
import {
  approveChannelPairing,
  approveChannelPairingBySender,
  listChannelPairingState,
  revokeChannelPairingPaired,
} from './pairing-service.js';

/** File-based pairing store adapter shared by telegram / feishu / weixin plugins. */
export function createStandardPairingAdapter(pairingChannel: PairingCliChannel): ChannelPairingAdapter {
  return {
    pairingChannel,
    listPending({ cfg, accountId }) {
      return listChannelPairingState({ channel: pairingChannel, accountId, config: cfg }).pending;
    },
    approveByCode({ cfg: _cfg, accountId, code }) {
      return approveChannelPairing({ channel: pairingChannel, accountId, code });
    },
    approveBySenderId({ cfg: _cfg, accountId, senderId }) {
      return approveChannelPairingBySender({ channel: pairingChannel, accountId, senderId });
    },
    revokePaired({ cfg: _cfg, accountId, senderId }) {
      return revokeChannelPairingPaired({ channel: pairingChannel, accountId, senderId });
    },
  };
}
