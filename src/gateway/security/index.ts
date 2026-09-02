export { safeEqualSecret } from './secret-equal.js';
export {
  assertGatewayAuthNotKnownWeak,
  KNOWN_WEAK_GATEWAY_TOKEN_PLACEHOLDERS,
} from './known-weak-secrets.js';
export { checkBrowserOrigin } from './origin-check.js';
export { computeInlineScriptHashes, buildGatewayConsoleCspHeader } from './csp.js';
export {
  GATEWAY_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  hasGatewayScope,
  isGatewayScope,
  parseGatewayScopes,
  requiredGatewayScope,
  type GatewayScope,
} from './gateway-scopes.js';
export {
  getGatewayPrincipal,
  setGatewayPrincipal,
  type GatewayPrincipal,
} from './gateway-principal.js';
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
  auditGatewayConfig,
  collectGatewayConfigFindings,
  collectGatewaySecurityFindings,
  collectGatewayStartupGuardFindings,
  type SecurityAuditFinding,
} from './audit.js';
export {
  wrapExternalContent,
  wrapWebContent,
  detectSuspiciousPatterns,
  type ExternalContentSource,
  type WrapExternalContentOptions,
} from './external-content.js';
