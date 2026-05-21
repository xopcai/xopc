export {
  assertTunnelMayStart,
  CURRENT_TUNNEL_CONSENT_VERSION,
  getTunnelConsentState,
  hasValidTunnelConsent,
  TUNNEL_CONSENT_REQUIRED_CODE,
  TUNNEL_RISK_SUMMARY_LINES,
  TunnelConsentError,
} from './consent.js';
export { TunnelBrokerClient, resolveBrokerApiBase } from './broker-client.js';
export {
  applyTunnelConsentToConfig,
  mergeTunnelConfigPatch,
  sanitizeTunnelConfig,
  setTunnelEnabledInConfig,
} from './tunnel-config.js';
export {
  clearFrpcPathForProcess,
  ensureFrpcBinary,
  FRPC_VERSION,
  publishFrpcPathForProcess,
} from './frpc-binary.js';
export {
  configureTunnelFromGatewayConfig,
  maybeAutoStartTunnelFromConfig,
  wireTunnelEventsToGateway,
} from './gateway-lifecycle.js';
export { fetchTunnelWellKnown, clearTunnelWellKnownCache } from './well-known.js';
export {
  isProductionTunnelBroker,
  resolveTunnelBrokerUrl,
  resolveTunnelRegistrationSecret,
} from './env.js';
export { getTunnelService, hashGatewayToken, TunnelService } from './tunnel-service.js';
export type { TunnelServiceConfig } from './tunnel-service.js';
export { buildMobileConnectQrPayload, resolveLanGatewayUrl } from './tunnel-qr.js';
export { loadTunnelState, saveTunnelState, resolveTunnelStatePath } from './tunnel-state.js';
export type { PersistedTunnelState, TunnelQrPayload, TunnelStatus, TunnelRegistration } from './tunnel-types.js';
