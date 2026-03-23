/**
 * Session routing
 *
 * Session key helpers, binding rules, and route resolution.
 */

// Session key utilities
export {
  buildSessionKey,
  parseSessionKey,
  sanitizeSegment,
  isValidSegment,
  isSubagentSessionKey,
  isAcpSessionKey,
  isCronSessionKey,
  getSubagentDepth,
  buildSubagentSessionKey,
  getParentSessionKey,
  normalizeSessionKey,
  type BuildSessionKeyParams,
  type ParsedSessionKey,
} from './session-key.js';

// Account id normalization
export {
  normalizeAccountId,
  normalizeOptionalAccountId,
  isValidAccountId,
  sanitizeAccountId,
  DEFAULT_ACCOUNT_ID,
} from './account-id.js';

// Binding rules
export {
  globMatch,
  matchesBinding,
  parseBindingRules,
  parseBindingRule,
  resolveRoute as resolveBindingRoute,
  type BindingMatch,
  type BindingRule,
  type RouteInput,
  type RouteResult,
} from './bindings.js';

// Route resolution
export {
  applyIdentityLinks,
  getDefaultAgentId,
  agentExists,
  pickFirstExistingAgentId,
  buildRouteSessionKey,
  deriveLastRoutePolicy,
  resolveRoute,
  resolveRouteFromSessionKey,
  type IdentityLinks,
  type SessionConfig,
  type AgentConfig,
  type RoutingConfig,
  type ResolveRouteInput,
  type ResolveRouteResult,
  type RouteContext,
} from './resolve-route.js';
