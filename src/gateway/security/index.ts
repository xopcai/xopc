export { safeEqualSecret } from './secret-equal.js';
export {
  assertGatewayAuthNotKnownWeak,
  KNOWN_WEAK_GATEWAY_TOKEN_PLACEHOLDERS,
} from './known-weak-secrets.js';
export { checkBrowserOrigin } from './origin-check.js';
export { computeInlineScriptHashes, buildGatewayConsoleCspHeader } from './csp.js';
export {
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  KNOWN_OPERATOR_SCOPES,
  DEFAULT_OPERATOR_SCOPES,
  isOperatorScope,
  authorizeRouteScope,
  authorizeScope,
  parseScopesHeader,
  type OperatorScope,
} from './operator-scopes.js';
export {
  DEFAULT_GATEWAY_HTTP_TOOL_DENY,
  isDangerousHttpTool,
  filterDangerousHttpTools,
} from './dangerous-tools.js';
export {
  createPreauthConnectionBudget,
  getMaxPreauthConnectionsPerIp,
  type PreauthConnectionBudget,
} from './preauth-connection-budget.js';
export {
  UnauthorizedFloodGuard,
  type FloodGuardOptions,
  type FloodGuardDecision,
} from './flood-guard.js';
export {
  auditGatewayConfig,
  type SecurityAuditFinding,
} from './audit.js';
export {
  wrapExternalContent,
  wrapWebContent,
  detectSuspiciousPatterns,
  type ExternalContentSource,
  type WrapExternalContentOptions,
} from './external-content.js';
