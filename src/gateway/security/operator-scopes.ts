/**
 * Operator scope system for fine-grained gateway API authorization.
 *
 * Each gateway API method maps to one or more required scopes.
 * Clients declare their scopes at connection time; the gateway enforces
 * that the declared scopes cover the method being invoked.
 */

export const ADMIN_SCOPE = 'operator.admin' as const;
export const READ_SCOPE = 'operator.read' as const;
export const WRITE_SCOPE = 'operator.write' as const;

export type OperatorScope =
  | typeof ADMIN_SCOPE
  | typeof READ_SCOPE
  | typeof WRITE_SCOPE;

const KNOWN_OPERATOR_SCOPE_VALUES: readonly OperatorScope[] = [
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
];

export const KNOWN_OPERATOR_SCOPES: ReadonlySet<OperatorScope> = new Set(
  KNOWN_OPERATOR_SCOPE_VALUES,
);

export function isOperatorScope(value: unknown): value is OperatorScope {
  return typeof value === 'string' && KNOWN_OPERATOR_SCOPES.has(value as OperatorScope);
}

/** Default scopes granted to authenticated CLI / direct connections. */
export const DEFAULT_OPERATOR_SCOPES: OperatorScope[] = [
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
];

/**
 * Route-level scope requirements.
 * Maps HTTP route path prefixes to required minimum scope.
 */
const ROUTE_SCOPE_REQUIREMENTS: ReadonlyArray<{ prefix: string; scope: OperatorScope }> = [
  // Admin routes
  { prefix: '/api/config', scope: ADMIN_SCOPE },
  { prefix: '/api/update', scope: ADMIN_SCOPE },
  { prefix: '/api/extensions/registry', scope: ADMIN_SCOPE },

  // Write routes
  { prefix: '/api/agent', scope: WRITE_SCOPE },
  { prefix: '/api/sessions', scope: WRITE_SCOPE },
  { prefix: '/api/automations', scope: WRITE_SCOPE },
  { prefix: '/api/automation-runs', scope: WRITE_SCOPE },
  { prefix: '/api/channels', scope: WRITE_SCOPE },
  { prefix: '/api/agents', scope: WRITE_SCOPE },
  { prefix: '/api/workspace', scope: WRITE_SCOPE },
  { prefix: '/api/skills', scope: WRITE_SCOPE },
  { prefix: '/api/marketplace/install', scope: ADMIN_SCOPE },
  { prefix: '/api/marketplace/uninstall', scope: ADMIN_SCOPE },
  { prefix: '/api/commands', scope: WRITE_SCOPE },
  { prefix: '/api/host-fs', scope: WRITE_SCOPE },

  // Read routes
  { prefix: '/api/status', scope: READ_SCOPE },
  { prefix: '/api/models', scope: READ_SCOPE },
  { prefix: '/api/logs', scope: READ_SCOPE },
  { prefix: '/api/doctor', scope: READ_SCOPE },
  { prefix: '/api/realtime', scope: READ_SCOPE },
];

/** Scope hierarchy: admin > write > read. */
const SCOPE_HIERARCHY: Record<OperatorScope, number> = {
  [ADMIN_SCOPE]: 3,
  [WRITE_SCOPE]: 2,
  [READ_SCOPE]: 1,
};

function scopeSatisfies(granted: OperatorScope, required: OperatorScope): boolean {
  return SCOPE_HIERARCHY[granted] >= SCOPE_HIERARCHY[required];
}

/**
 * Check whether a set of granted scopes satisfies the required scope for a route.
 */
export function authorizeRouteScope(
  routePath: string,
  grantedScopes: readonly OperatorScope[],
): { allowed: true } | { allowed: false; requiredScope: OperatorScope } {
  const routeRequirement = ROUTE_SCOPE_REQUIREMENTS.find(
    (entry) => routePath.startsWith(entry.prefix),
  );

  if (!routeRequirement) {
    // Routes without explicit scope requirements default to read
    return authorizeScope(READ_SCOPE, grantedScopes);
  }

  return authorizeScope(routeRequirement.scope, grantedScopes);
}

/**
 * Check whether any of the granted scopes satisfies the required scope.
 */
export function authorizeScope(
  requiredScope: OperatorScope,
  grantedScopes: readonly OperatorScope[],
): { allowed: true } | { allowed: false; requiredScope: OperatorScope } {
  const hasSufficientScope = grantedScopes.some(
    (granted) => scopeSatisfies(granted, requiredScope),
  );

  if (hasSufficientScope) {
    return { allowed: true };
  }
  return { allowed: false, requiredScope };
}

/**
 * Parse scopes from a comma-separated header value.
 */
export function parseScopesHeader(headerValue: string | undefined): OperatorScope[] {
  if (!headerValue?.trim()) {
    return [...DEFAULT_OPERATOR_SCOPES];
  }
  return headerValue
    .split(',')
    .map((scope) => scope.trim())
    .filter(isOperatorScope);
}
