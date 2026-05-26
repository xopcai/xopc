/**
 * Cross-domain setup manifest registry.
 *
 * Each setup-style command (`xopc providers`, `xopc channels`, …) registers
 * a {@link SetupDomainDescriptor} at module-load time via
 * {@link registerSetupDomain}. The `xopc setup manifest` command imports all
 * known command modules and emits the aggregated descriptor as JSON, giving
 * agents (M2 skills) and the WebUI (M3) a single source of truth for "what
 * can I configure and how?".
 */

export type SetupFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'url'
  | 'enum';

export interface SetupFieldDescriptor {
  type: SetupFieldType;
  description: string;
  required?: boolean;
  /** True when the field is sensitive — UIs should use a password input, agents should never echo it. */
  secret?: boolean;
  /** Default value, when applicable (display only). */
  default?: unknown;
  /** Enum values, when type === 'enum'. */
  enum?: readonly string[];
  /** Where to obtain the value (URL or short hint). */
  source?: string;
}

export interface SetupActionDescriptor {
  /** Action name — `list`, `set-key`, `add`, `remove`, `verify`, `schema`. */
  name: string;
  /** CLI invocation example. */
  cli: string;
  description: string;
  /** Subset of `fields` keys this action consumes. */
  fields?: readonly string[];
}

export interface SetupTargetDescriptor {
  id: string;
  name: string;
  /** Free-form metadata (category, capabilities, env var, etc.). */
  meta?: Record<string, unknown>;
}

export interface SetupDomainDescriptor {
  /** Domain id matching the `domain` field of `SetupOutcome`. */
  domain: string;
  description: string;
  /** Human/agent-friendly link to deeper docs. */
  docs?: string;
  /** Where the changes land (file path, store name, etc.). */
  storage?: string;
  actions: readonly SetupActionDescriptor[];
  fields: Readonly<Record<string, SetupFieldDescriptor>>;
  /**
   * Lazy snapshot of available targets (provider ids, channel ids, …). Called
   * when building the manifest; may read configuration but must not throw.
   */
  targets?: () => readonly SetupTargetDescriptor[];
}

export interface SetupManifest {
  version: 1;
  domains: SetupDomainDescriptor[];
}

const REGISTRY = new Map<string, SetupDomainDescriptor>();

export function registerSetupDomain(descriptor: SetupDomainDescriptor): void {
  REGISTRY.set(descriptor.domain, descriptor);
}

export function getRegisteredDomains(): SetupDomainDescriptor[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

export function buildSetupManifest(): SetupManifest {
  return { version: 1, domains: getRegisteredDomains() };
}

/**
 * Serialize the manifest, evaluating each domain's `targets()` thunk.
 * Errors from `targets()` are swallowed and reported as `targets: []` rather
 * than failing the whole manifest — partial output is more useful for agents
 * than no output.
 */
export function serializeSetupManifest(): {
  version: 1;
  domains: Array<Omit<SetupDomainDescriptor, 'targets'> & { targets?: SetupTargetDescriptor[] }>;
} {
  return {
    version: 1,
    domains: getRegisteredDomains().map(({ targets, ...rest }) => {
      let resolved: SetupTargetDescriptor[] | undefined;
      if (targets) {
        try {
          resolved = [...targets()];
        } catch {
          resolved = [];
        }
      }
      return { ...rest, ...(resolved ? { targets: resolved } : {}) };
    }),
  };
}
