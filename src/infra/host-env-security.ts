import policyJson from './host-env-security-policy.json' with { type: 'json' };

type HostEnvPolicy = {
  blockedEverywhereKeys?: string[];
  blockedPrefixes?: string[];
  blockedOverrideOnlyKeys?: string[];
  blockedOverridePrefixes?: string[];
  blockedInheritedPrefixes?: string[];
  allowedInheritedOverrideOnlyKeys?: string[];
};

const policy = policyJson as HostEnvPolicy;

const blockedKeys = new Set(
  (policy.blockedEverywhereKeys ?? []).map((k) => k.toUpperCase()),
);
const blockedPrefixes = (policy.blockedPrefixes ?? []).map((p) => p.toUpperCase());

export function isDangerousHostEnvVarName(rawKey: string): boolean {
  const key = rawKey.trim().toUpperCase();
  if (!key) {
    return false;
  }
  if (blockedKeys.has(key)) {
    return true;
  }
  return blockedPrefixes.some((prefix) => key.startsWith(prefix));
}
