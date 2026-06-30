import type { EffectiveAgentManifest } from '../agent-manifest/schema.js';

export type BoundaryDecision = 'allow' | 'confirm' | 'deny' | 'escalate';

export interface BoundaryCheckParams {
  manifest: EffectiveAgentManifest;
  action: string;
  detail?: string;
}

export interface BoundaryCheckResult {
  decision: BoundaryDecision;
  matchedRule?: string;
}

function matchesRule(action: string, detail: string | undefined, rule: string): boolean {
  const haystack = `${action}\n${detail ?? ''}`.toLowerCase();
  return haystack.includes(rule.toLowerCase());
}

export function checkBoundary(params: BoundaryCheckParams): BoundaryCheckResult {
  for (const rule of params.manifest.boundaries.forbidden) {
    if (matchesRule(params.action, params.detail, rule)) {
      return { decision: 'deny', matchedRule: rule };
    }
  }
  for (const rule of params.manifest.boundaries.escalation) {
    if (matchesRule(params.action, params.detail, rule)) {
      return { decision: 'escalate', matchedRule: rule };
    }
  }
  for (const rule of params.manifest.boundaries.requiresConfirmation) {
    if (matchesRule(params.action, params.detail, rule)) {
      return { decision: 'confirm', matchedRule: rule };
    }
  }
  return { decision: 'allow' };
}
