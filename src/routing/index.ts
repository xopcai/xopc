/**
 * Session 路由系统
 * 
 * 提供完整的 session key 管理、binding 规则解析和路由决策功能。
 */

// Session Key 工具
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

// Account ID 规范化
export {
  normalizeAccountId,
  normalizeOptionalAccountId,
  isValidAccountId,
  sanitizeAccountId,
  DEFAULT_ACCOUNT_ID,
} from './account-id.js';

// Binding 规则管理
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

// 路由决策引擎
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
