import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { resolveEffectiveAgentConfig, type EffectiveAgentConfig } from '../agent-config/index.js';
import type { Config } from '../config/schema.js';
import { getAvailablePersonalAgentTools, personalAgentModelAvailability } from '../personal-agent/specialist-capabilities.js';
import { normalizeSpecialistRequirements, type SpecialistTaskRequirements } from './schema.js';

export const MATCHER_VERSION = 1;
export type Eligibility = 'eligible' | 'needs_verification' | 'blocked';
export interface AvailabilityCheck {
  condition: string;
  state: 'verified' | 'configured' | 'unknown' | 'blocked';
  reasonCode: string;
  detail?: string;
}
export interface MatchingContext {
  ownAgentId: string;
  getConfig?: () => Config | undefined;
  getAgentSkillAvailability?: (agentId: string) => {
    skills: Array<{ name: string; availableForCurrentAgent: boolean; unavailableReason?: string | null }>;
  };
  legacyToolPolicyOnly?: boolean;
  getAgentToolAvailability?: (agentId: string, tool: string) => AvailabilityCheck;
  checkConnector?: (agentId: string, connector: NonNullable<SpecialistTaskRequirements['connector']>) => AvailabilityCheck;
}
export interface SpecialistAssessment {
  id: string;
  revision?: number;
  name: string;
  description: string;
  profileSource: 'declared' | 'legacy';
  specialistProfile?: EffectiveAgentConfig['specialistProfile'];
  availableTools: string[];
  model: { available: boolean; reason?: string };
  verifiedSkills: string[];
  eligibility: Eligibility;
  checks: AvailabilityCheck[];
  matched: string[];
  missing: string[];
  catalogRevision: number;
  checkedAt: number;
  matcherVersion: number;
}

export function assessSpecialist(agentId: string, input: SpecialistTaskRequirements, context: MatchingContext): SpecialistAssessment {
  const requirements = normalizeSpecialistRequirements(input);
  const repository = new AgentCatalogRepository();
  const agent = repository.get(agentId);
  const checks: AvailabilityCheck[] = [];
  const add = (condition: string, state: AvailabilityCheck['state'], reasonCode: string, detail?: string) =>
    checks.push({ condition, state, reasonCode, ...(detail ? { detail } : {}) });
  const identityValid = agent && agent.enabled !== false && agent.provisioningState === 'ready'
    && agent.purpose !== 'task_dispatcher' && agent.id !== context.ownAgentId && !agent.id.startsWith('personal-');
  add('identity', identityValid ? 'verified' : 'blocked', identityValid ? 'agent_ready' : 'agent_unavailable');
  if (requirements.requestedAgentId && requirements.requestedAgentId !== agentId) add('requestedAgent', 'blocked', 'requested_agent_mismatch');
  const entry = agent ? (({ revision: _revision, provisioningState: _state, provisioningError: _error,
    createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...value }) => value)(agent) : undefined;
  const config = entry ? resolveEffectiveAgentConfig({ defaults: repository.getSettings().defaults, agent: entry }).config : undefined;
  const model = config ? personalAgentModelAvailability(config) : { available: false, reason: 'Agent unavailable' };
  add('model', model.available ? 'configured' : 'blocked', model.available ? 'provider_configured_network_unverified' : 'model_unavailable', model.reason);
  const availableTools = config ? getAvailablePersonalAgentTools(config, context) : [];
  for (const tool of requirements.requiredTools ?? []) {
    if (!identityValid) { add(`tool:${tool}`, 'blocked', 'agent_unavailable'); continue; }
    const policyAllows = config && config.tools[tool]?.mode !== 'deny'
      && (!config.toolAllowlist || config.toolAllowlist.includes(tool));
    if (!policyAllows) add(`tool:${tool}`, 'blocked', 'tool_unavailable');
    else {
      let check: AvailabilityCheck | undefined;
      try { check = context.getAgentToolAvailability?.(agentId, tool); }
      catch { check = { condition: `tool:${tool}`, state: 'unknown', reasonCode: 'tool_verification_failed' }; }
      check ??= context.legacyToolPolicyOnly
        ? { condition: `tool:${tool}`, state: availableTools.includes(tool) ? 'configured' : 'blocked', reasonCode: 'legacy_tool_policy_only' }
        : { condition: `tool:${tool}`, state: 'unknown', reasonCode: 'tool_configured_registration_unverified' };
      checks.push(check);
      if (check.state === 'verified' && !availableTools.includes(tool)) availableTools.push(tool);
    }
  }
  const verifiedSkills: string[] = [];
  if (requirements.requiredSkills?.length) {
    let skills: ReturnType<NonNullable<MatchingContext['getAgentSkillAvailability']>>['skills'] | undefined;
    try { skills = identityValid ? context.getAgentSkillAvailability?.(agentId).skills : undefined; }
    catch { /* Failed probes stay unverified; another candidate can still be considered. */ }
    for (const name of requirements.requiredSkills) {
      const skill = skills?.find(item => item.name.toLowerCase() === name);
      if (skill?.availableForCurrentAgent) {
        verifiedSkills.push(skill.name);
        add(`skill:${name}`, 'verified', 'skill_available');
      } else add(`skill:${name}`, skills ? 'blocked' : 'unknown', skills ? 'skill_unavailable' : 'skill_verification_unavailable', skill?.unavailableReason ?? (skills ? 'not-installed' : 'Skill availability cannot be verified'));
    }
  }
  if (requirements.connector) {
    let check: AvailabilityCheck | undefined;
    try { check = identityValid ? context.checkConnector?.(agentId, requirements.connector) : undefined; }
    catch { check = { condition: 'connector', state: 'unknown', reasonCode: 'connector_verification_failed' }; }
    checks.push(check ?? { condition: 'connector', state: 'unknown', reasonCode: 'connector_verification_unavailable' });
  }
  const matched: string[] = [];
  const missing: string[] = [];
  const profile = agent?.specialistProfile;
  const tags = [
    ...(requirements.domain ? [['domain', requirements.domain, profile?.domains] as const] : []),
    ...(requirements.taskType ? [['taskType', requirements.taskType, profile?.taskTypes] as const] : []),
    ...(requirements.inputKinds ?? []).map(value => ['input', value, profile?.inputKinds] as const),
    ...(requirements.outputKinds ?? []).map(value => ['output', value, profile?.outputKinds] as const),
  ];
  for (const [kind, value, declared] of tags) (declared?.includes(value) ? matched : missing).push(`${kind}:${value}`);
  return {
    id: agentId, revision: agent?.revision, name: agent?.profile?.name ?? agentId,
    description: (agent?.profile?.description ?? '').slice(0, 300), profileSource: profile ? 'declared' : 'legacy',
    ...(profile ? { specialistProfile: profile } : {}), availableTools, model, verifiedSkills,
    eligibility: checks.some(check => check.state === 'blocked') ? 'blocked'
      : checks.some(check => check.state === 'unknown') ? 'needs_verification' : 'eligible',
    checks, matched, missing, catalogRevision: repository.getRevision(), checkedAt: Date.now(), matcherVersion: MATCHER_VERSION,
  };
}

export function matchSpecialists(input: SpecialistTaskRequirements, context: MatchingContext, options: { cursor?: string; limit?: number } = {}) {
  const requirements = normalizeSpecialistRequirements(input);
  const repository = new AgentCatalogRepository();
  const revision = repository.getRevision();
  let offset = 0;
  if (options.cursor) {
    const match = /^(\d+):(\d+)$/.exec(options.cursor);
    if (!match || Number(match[1]) !== revision) throw new Error('Specialist catalog changed; restart matching');
    offset = Number(match[2]);
    if (!Number.isSafeInteger(offset)) throw new Error('Invalid matching cursor');
  }
  const ids = requirements.requestedAgentId ? [requirements.requestedAgentId] : repository.list()
    .filter(agent => agent.purpose !== 'task_dispatcher' && agent.id !== context.ownAgentId && !agent.id.startsWith('personal-')).map(agent => agent.id);
  const order = { eligible: 0, needs_verification: 1, blocked: 2 };
  const candidates = ids.map(id => assessSpecialist(id, requirements, context)).sort((a, b) =>
    order[a.eligibility] - order[b.eligibility]
    || Number(b.matched.some(tag => tag.startsWith('taskType:'))) - Number(a.matched.some(tag => tag.startsWith('taskType:')))
    || Number(b.matched.some(tag => tag.startsWith('domain:'))) - Number(a.matched.some(tag => tag.startsWith('domain:')))
    || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  return { matcherVersion: MATCHER_VERSION, catalogRevision: revision, checkedAt: Date.now(), total: candidates.length,
    candidates: candidates.slice(offset, offset + limit),
    ...(offset + limit < candidates.length ? { nextCursor: `${revision}:${offset + limit}` } : {}) };
}

export function listSpecialistSummaries(context: MatchingContext) {
  return matchSpecialists({ version: 1, summary: 'Specialist discovery' }, context, { limit: 50 });
}

/** Cheap snapshot projection; configuration is not proof of runtime tool readiness. */
export function summarizeSpecialist(config: EffectiveAgentConfig, context: Pick<MatchingContext, 'getConfig'>) {
  return { id: config.id, role: (config.profile?.description || config.profile?.name || config.id).slice(0, 80),
    tools: getAvailablePersonalAgentTools(config, context),
    available: personalAgentModelAvailability(config).available,
    toolEvidence: 'configured',
    ...(config.specialistProfile ? { domains: config.specialistProfile.domains, taskTypes: config.specialistProfile.taskTypes,
      outputKinds: config.specialistProfile.outputKinds, specialties: config.specialistProfile.specialties.slice(0, 2) } : { profileSource: 'legacy' }),
  };
}
