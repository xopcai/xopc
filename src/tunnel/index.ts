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
  getTunnelRegistrationSecretMeta,
  isProductionTunnelBroker,
  isMaskedTunnelSecretPatchValue,
  resolveTunnelBrokerUrl,
  resolveTunnelRegistrationSecret,
} from './env.js';
export type { TunnelRegistrationSecretMeta, TunnelRegistrationSecretSource } from './env.js';
export { logTunnelAudit } from './tunnel-audit.js';
export type { TunnelAuditEvent } from './tunnel-audit.js';
export { consumeTunnelMutationLimit, resetTunnelMutationLimitsForTests } from './tunnel-rate-limit.js';
export { getTunnelService, hashGatewayToken, TunnelService } from './tunnel-service.js';
export type { TunnelServiceConfig } from './tunnel-service.js';
export { resolveFrpSubdomainHost, resolveTunnelE2eConfig } from './tunnel-e2e-config.js';
export type { ResolvedTunnelE2eConfig } from './tunnel-e2e-config.js';
export { getCertStatusSummary, subscribeCertStatus, recordRenewalFailure } from './acme-cert-store.js';
export { getActiveTlsCert, stopTunnelTlsServer } from './tls-server.js';
export { createPairingSecret, consumePairingSecret, resetPairingSessionsForTests } from './pairing.js';
export type { PairingSecretResult } from './pairing.js';
export { buildMobileConnectQrPayload, resolveLanGatewayUrl } from './tunnel-qr.js';
export { loadTunnelState, saveTunnelState, resolveTunnelStatePath } from './tunnel-state.js';
export type { PersistedTunnelState, TunnelQrPayload, TunnelStatus, TunnelRegistration } from './tunnel-types.js';
