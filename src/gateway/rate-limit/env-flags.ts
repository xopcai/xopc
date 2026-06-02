/**
 * Process-level env-var feature flags that influence rate-limit and gateway
 * security behavior. Kept as a tiny module so non-gateway packages can read
 * them without pulling the rate-limit subsystem.
 */

export function isAuthRateLimitGloballyDisabled(): boolean {
  return process.env.XOPC_AUTH_RATE_LIMIT === 'false';
}

export function isGatewayStrictSecurityEnabled(cfg?: {
  gateway?: { security?: { strict?: boolean } };
}): boolean {
  return (
    cfg?.gateway?.security?.strict === true ||
    process.env.XOPC_GATEWAY_STRICT_SECURITY === '1'
  );
}
