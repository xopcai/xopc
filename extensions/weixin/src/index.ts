import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';

import { weixinPlugin } from './plugin.js';

export { weixinPlugin, WeixinChannelPlugin } from './plugin.js';
export { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';
export {
  normalizeWeixinCronDeliveryTo,
  normalizeWeixinCronDeliveryToResolved,
  resolveWeixinAccountIdFromSessions,
} from './delivery-to.js';
export type { NormalizedWeixinCronDelivery } from './delivery-to.js';
export { runWeixinQrLoginCli } from './cli/qr-login.js';
export type { WeixinQrLoginCliOptions } from './cli/qr-login.js';
export {
  getWeixinGatewayQrLoginStatus,
  startWeixinGatewayQrLogin,
} from './cli/gateway-qr-login.js';
export type {
  WeixinGatewayQrLoginStartOptions,
  WeixinGatewayQrLoginStatus,
} from './cli/gateway-qr-login.js';

export default defineChannelPluginEntry({
  id: 'weixin',
  name: 'Weixin',
  description: 'Personal WeChat channel through QR login',
  plugin: weixinPlugin,
});
