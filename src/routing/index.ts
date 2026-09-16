/**
 * Session routing
 *
 * Session key helpers, binding rules, and route resolution.
 */

// Session key utilities
export {
  resolveConversationId,
  getConversationRouting,
  sanitizeSegment,
  isValidSegment,
  isSubagentConversationId,
  isCronConversationId,
  getParentConversationId,
  normalizeConversationId,
  resolveAgentMainConversationId,
  resolveAgentPeerConversationId,
  defaultMainConversationId,
  getConversation,
  resolveAgentIdFromConversationId,
  assertAgentConversationId,
  normalizeAgentId,
  normalizeMainKey,
  DEFAULT_AGENT_ID,
  DEFAULT_MAIN_KEY,
  type BuildConversationIdParams,
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
  buildRouteConversationId,
  resolveRoute,
  resolveRouteFromConversationId,
  type IdentityLinks,
  type SessionConfig,
  type AgentConfig,
  type RoutingConfig,
  type ResolveRouteInput,
  type ResolveRouteResult,
  type RouteContext,
} from './resolve-route.js';
