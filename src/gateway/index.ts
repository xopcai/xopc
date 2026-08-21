export { GatewayServer, type GatewayServerConfig } from './server.js';
export {
  GatewayService,
  type GatewayChannelStartupPhase1Metrics,
  type GatewayChannelStartupPhase2Metrics,
  type GatewayServiceConfig,
} from './service.js';

export { acquireGatewayLock, GatewayLockError, type GatewayLockHandle } from './lock.js';
export { runGatewayLoop, type RunGatewayLoopOptions } from './run-loop.js';
export { restartGatewayProcessWithFreshPid, type GatewayRespawnResult } from './respawn.js';
export {
  listPortListeners,
  forceFreePortAndWait,
  checkPortAvailable,
  parseLsofOutput,
  type PortProcess,
  type ForceFreePortResult,
} from './ports.js';

export * from './protocol.js';
export * from './hono/index.js';
export * from './auth.js';
export {
  assertGatewayRuntimeConfig,
  type GatewayRuntimeConfig,
} from './runtime-config.js';
export {
  isLoopbackHost,
  isAllInterfacesHost,
  buildDefaultCorsOrigins,
  resolveEffectiveGatewayPort,
  resolveGatewayServiceListenPort,
} from './host.js';
export {
  resolveGatewayListenHost,
  resolveGatewayListenPlan,
} from './listen.js';
export {
  resolveGatewayBindMode,
  resolveGatewayBindHost,
  resolveGatewayBindHostSync,
  resolveGatewayEffectiveHost,
  defaultGatewayBindMode,
  isContainerEnvironment,
} from '../config/gateway-bind.js';
export {
  isSecureWebSocketUrl,
  assertSecureWebSocketUrl,
  assertSecureGatewayHttpUrl,
  isInsecurePrivateWsAllowed,
} from './ws-security.js';
export { isGatewayStrictSecurityEnabled, buckets } from './rate-limit/index.js';
