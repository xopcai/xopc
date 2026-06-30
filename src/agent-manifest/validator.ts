import type { AgentManifest, CapabilityPreset, EffectiveAgentManifest } from './schema.js';
import { resolveEffectiveAgentManifest } from './resolver.js';

export type ManifestIssueSeverity = 'error' | 'warning';

export interface ManifestIssue {
  severity: ManifestIssueSeverity;
  path: string;
  message: string;
}

export interface ManifestCatalogs {
  tools?: Iterable<string>;
  skills?: Iterable<string>;
  workflows?: Iterable<string>;
  mcpServers?: Iterable<string>;
}

export interface ValidateManifestParams {
  agent: AgentManifest;
  presets?: Record<string, CapabilityPreset>;
  catalogs?: ManifestCatalogs;
}

export interface ValidateManifestResult {
  ok: boolean;
  manifest?: EffectiveAgentManifest;
  issues: ManifestIssue[];
}

function toSet(values: Iterable<string> | undefined): Set<string> | undefined {
  if (!values) return undefined;
  return new Set([...values].map((value) => value.toLowerCase()));
}

function hasValue(set: Set<string> | undefined, value: string): boolean {
  return set === undefined || set.has(value.toLowerCase());
}

function addIssue(issues: ManifestIssue[], severity: ManifestIssueSeverity, path: string, message: string): void {
  issues.push({ severity, path, message });
}

function validateModels(manifest: EffectiveAgentManifest, issues: ManifestIssue[]): void {
  if (!manifest.models.roles[manifest.models.defaultRole]) {
    addIssue(
      issues,
      'error',
      'models.defaultRole',
      `defaultRole "${manifest.models.defaultRole}" does not exist in models.roles`,
    );
  }
}

function validateTools(manifest: EffectiveAgentManifest, issues: ManifestIssue[], catalogs: ManifestCatalogs): void {
  const tools = toSet(catalogs.tools);
  for (const [name, policy] of Object.entries(manifest.tools.builtin)) {
    if (!hasValue(tools, name)) {
      addIssue(issues, 'error', `tools.builtin.${name}`, `tool "${name}" is not in the tool catalog`);
    }
    if (policy.mode === 'allow' && policy.scope === 'unrestricted') {
      addIssue(
        issues,
        'warning',
        `tools.builtin.${name}.scope`,
        `tool "${name}" is unrestricted; consider using confirm or a narrower scope`,
      );
    }
  }

  const mcpServers = toSet(catalogs.mcpServers);
  for (const serverName of Object.keys(manifest.tools.mcp?.servers ?? {})) {
    if (!hasValue(mcpServers, serverName)) {
      addIssue(issues, 'error', `tools.mcp.servers.${serverName}`, `MCP server "${serverName}" is not configured`);
    }
  }
}

function validateSkills(manifest: EffectiveAgentManifest, issues: ManifestIssue[], catalogs: ManifestCatalogs): void {
  const skills = toSet(catalogs.skills);
  for (const name of manifest.skills.allow ?? []) {
    if (!hasValue(skills, name)) {
      addIssue(issues, 'error', `skills.allow`, `skill "${name}" is not installed`);
    }
  }
  for (const name of manifest.skills.deny ?? []) {
    if (!hasValue(skills, name)) {
      addIssue(issues, 'warning', `skills.deny`, `skill "${name}" is not installed`);
    }
  }
  if (manifest.skills.mode === 'allowlist' && (manifest.skills.allow?.length ?? 0) === 0) {
    addIssue(issues, 'warning', 'skills.allow', 'allowlist mode has no allowed skills');
  }
}

function validateMemory(manifest: EffectiveAgentManifest, issues: ManifestIssue[]): void {
  if (manifest.memory.mode === 'off' && manifest.memory.sources.some((source) => source !== 'session')) {
    addIssue(issues, 'warning', 'memory.sources', 'memory sources are configured while memory mode is off');
  }
  if (manifest.memory.mode === 'auto') {
    const privacy = manifest.memory.privacy;
    if (!privacy || privacy.sensitiveWritePolicy === 'allow') {
      addIssue(issues, 'warning', 'memory.privacy', 'auto memory writes should configure sensitiveWritePolicy');
    }
  }
  if (manifest.memory.mode !== 'off') {
    const policy = manifest.memory.writePolicy ?? {};
    const hasWritePolicy = Object.values(policy).some(Boolean);
    if (!hasWritePolicy && manifest.memory.mode !== 'readOnly') {
      addIssue(issues, 'warning', 'memory.writePolicy', 'write-capable memory mode has no write policy');
    }
  }
}

function validateWorkflows(manifest: EffectiveAgentManifest, issues: ManifestIssue[], catalogs: ManifestCatalogs): void {
  const workflows = toSet(catalogs.workflows);
  const check = (path: string, value: string | undefined) => {
    if (value && !hasValue(workflows, value)) {
      addIssue(issues, 'error', path, `workflow "${value}" is not in the workflow catalog`);
    }
  };
  check('workflows.default', manifest.workflows.default);
  for (const [index, value] of (manifest.workflows.allowed ?? []).entries()) {
    check(`workflows.allowed.${index}`, value);
  }
  for (const [index, entry] of (manifest.workflows.suggested ?? []).entries()) {
    check(`workflows.suggested.${index}.workflow`, entry.workflow);
  }
}

export function validateAgentManifest(params: ValidateManifestParams): ValidateManifestResult {
  const issues: ManifestIssue[] = [];
  let manifest: EffectiveAgentManifest;
  try {
    manifest = resolveEffectiveAgentManifest({
      agent: params.agent,
      presets: params.presets,
    }).manifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [{ severity: 'error', path: 'manifest', message }],
    };
  }

  validateModels(manifest, issues);
  validateTools(manifest, issues, params.catalogs ?? {});
  validateSkills(manifest, issues, params.catalogs ?? {});
  validateMemory(manifest, issues);
  validateWorkflows(manifest, issues, params.catalogs ?? {});

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    manifest,
    issues,
  };
}
