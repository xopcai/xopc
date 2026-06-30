import type { EffectiveAgentManifest, ToolPolicy } from '../agent-manifest/schema.js';

export interface ToolCatalogEntry<TTool = unknown> {
  name: string;
  category: 'file' | 'web' | 'code' | 'memory' | 'communication' | 'automation' | 'mcp' | 'other';
  risk: 'low' | 'medium' | 'high';
  supportsConfirm: boolean;
  supportsDryRun?: boolean;
  scopes?: Array<'readonly' | 'workspace' | 'unrestricted'>;
  tool: TTool;
}

export interface RuntimeToolEntry<TTool = unknown> {
  name: string;
  policy: ToolPolicy;
  catalog: ToolCatalogEntry<TTool>;
  requiresConfirmation: boolean;
  tool: TTool;
}

export interface BuildRuntimeToolRegistryParams<TTool = unknown> {
  manifest: EffectiveAgentManifest;
  catalog: Iterable<ToolCatalogEntry<TTool>>;
}

export interface RuntimeToolRegistry<TTool = unknown> {
  tools: RuntimeToolEntry<TTool>[];
  denied: string[];
  missing: string[];
  warnings: string[];
}

function scopeSupported(entry: ToolCatalogEntry, policy: ToolPolicy): boolean {
  if (!policy.scope) return true;
  return !entry.scopes || entry.scopes.includes(policy.scope);
}

export function buildRuntimeToolRegistry<TTool = unknown>(
  params: BuildRuntimeToolRegistryParams<TTool>,
): RuntimeToolRegistry<TTool> {
  const byName = new Map([...params.catalog].map((entry) => [entry.name, entry]));
  const tools: RuntimeToolEntry<TTool>[] = [];
  const denied: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const [name, policy] of Object.entries(params.manifest.tools.builtin)) {
    if (policy.mode === 'deny') {
      denied.push(name);
      continue;
    }
    const entry = byName.get(name);
    if (!entry) {
      missing.push(name);
      continue;
    }
    if (policy.mode === 'confirm' && !entry.supportsConfirm) {
      warnings.push(`tool "${name}" requires confirmation but does not support a confirm wrapper`);
      continue;
    }
    if (!scopeSupported(entry, policy)) {
      warnings.push(`tool "${name}" does not support scope "${policy.scope}"`);
      continue;
    }
    tools.push({
      name,
      policy,
      catalog: entry,
      requiresConfirmation: policy.mode === 'confirm',
      tool: entry.tool,
    });
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));
  denied.sort();
  missing.sort();
  warnings.sort();

  return { tools, denied, missing, warnings };
}
