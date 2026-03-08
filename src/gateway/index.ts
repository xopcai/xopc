export { GatewayServer, type GatewayServerConfig } from './server.js';
export { GatewayService, type GatewayServiceConfig, type ServiceEvent } from './service.js';

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
