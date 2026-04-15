/**
 * Stable imports for the bundled Weixin channel (implementation under extensions/weixin).
 */

export {
  weixinPlugin,
  WeixinChannelPlugin,
  runWeixinQrLoginCli,
  getWeixinGatewayQrLoginStatus,
  startWeixinGatewayQrLogin,
  normalizeWeixinCronDeliveryTo,
  normalizeWeixinCronDeliveryToResolved,
  resolveWeixinAccountIdFromSessions,
} from '../../../extensions/weixin/src/index.js';
export type { NormalizedWeixinCronDelivery } from '../../../extensions/weixin/src/index.js';
export type {
  WeixinQrLoginCliOptions,
  WeixinGatewayQrLoginStartOptions,
  WeixinGatewayQrLoginStatus,
} from '../../../extensions/weixin/src/index.js';
