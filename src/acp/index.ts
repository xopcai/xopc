/**
 * ACP Main Index
 */

// Runtime types
export type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeEvent,
  AcpRuntimeCapabilities,
  AcpSessionStatus,
  SessionAcpMeta,
  AcpSessionResolution,
} from "./runtime/types.js";

// Runtime registry
export {
  registerAcpRuntimeBackend,
  unregisterAcpRuntimeBackend,
  getAcpRuntimeBackend,
  requireAcpRuntimeBackend,
  listAcpRuntimeBackends,
  hasAcpRuntimeBackend,
} from "./runtime/registry.js";

// Errors
export { AcpRuntimeError } from "./runtime/errors.js";

// Control Plane
export { AcpSessionManager, getAcpSessionManager, getAcpSessionManagerAsync } from "./control-plane/manager.js";
export type {
  AcpInitializeSessionInput,
  AcpRunTurnInput,
  AcpCloseSessionInput,
  AcpCloseSessionResult,
  AcpManagerObservabilitySnapshot,
} from "./control-plane/manager.types.js";