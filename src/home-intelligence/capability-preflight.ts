import type {
  HomeCapabilityBlocker,
  HomeCapabilityPreflight,
  HomeCapabilityReadiness,
} from '@xopcai/gateway-contract';

import type { Config } from '../config/schema.js';
import { preflightConnectorRequirements } from '../connectors/workflow-preflight.js';
import { listConnectorInstances } from '../connectors/instances.js';
import type { AgentSkillUnavailableReason } from '../agent/agent-manager.js';
import type { HomeCapabilityInventory } from './types.js';

export interface HomeCapabilityRequirement {
  kind: 'connector' | 'skill' | 'agent';
  capability: string;
  required: boolean;
}

export interface HomeSkillAvailability {
  name: string;
  availableForCurrentAgent: boolean;
  unavailableReason: AgentSkillUnavailableReason | null;
}

export interface HomeCapabilityResolution {
  capabilities: HomeCapabilityReadiness[];
  preflight: HomeCapabilityPreflight;
}

export interface HomeCapabilityPreflightDeps {
  config(): Config;
  agentId(): string;
  skills(agentId: string): HomeSkillAvailability[];
  principalId: string;
}

const SKILL_CODE: Record<AgentSkillUnavailableReason, HomeCapabilityBlocker['code']> = {
  'agent-denied': 'agent_not_allowed',
  disabled: 'disabled',
  'requirements-unmet': 'requirements_unmet',
  'model-invocation-disabled': 'model_invocation_disabled',
  'tool-gated': 'tool_gated',
};

function withReturnPath(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}returnTo=${encodeURIComponent('/')}`;
}

export class HomeCapabilityPreflightService {
  constructor(private readonly deps: HomeCapabilityPreflightDeps) {}

  inventory(): HomeCapabilityInventory {
    const config = this.deps.config();
    const agentId = this.deps.agentId();
    const connectorRequirements = listConnectorInstances(config).map((instance) => ({
      kind: 'connector' as const,
      capability: instance.connectorId,
      required: true,
    }));
    const connectorResolution = this.resolve(connectorRequirements);
    const connectors = new Set(connectorResolution.capabilities
      .filter((capability) => capability.kind === 'connector' && capability.readiness === 'ready')
      .map((capability) => capability.capability));
    const skills = new Set(this.deps.skills(agentId)
      .filter((skill) => skill.availableForCurrentAgent)
      .map((skill) => skill.name));
    return { agentId, connectors, skills };
  }

  resolve(
    requirements: readonly HomeCapabilityRequirement[],
    options: { degradedActionAvailable?: boolean } = {},
  ): HomeCapabilityResolution {
    const agentId = this.deps.agentId();
    const skills = requirements.some((item) => item.kind === 'skill') ? this.deps.skills(agentId) : [];
    const connectorRequirements = requirements
      .filter((item) => item.kind === 'connector')
      .map((item) => ({
        connectorId: item.capability,
        scope: 'read' as const,
        optional: !item.required,
      }));
    const connectorResult = preflightConnectorRequirements({
      requirements: connectorRequirements,
      config: this.deps.config(),
      agentId,
      principalId: this.deps.principalId,
    });
    const connectorIssues = new Map([
      ...connectorResult.issues,
      ...connectorResult.optionalIssues,
    ].map((issue) => [issue.connectorId, issue]));
    const blockers: HomeCapabilityBlocker[] = [];

    const capabilities = requirements.map((requirement): HomeCapabilityReadiness => {
      if (requirement.kind === 'agent') {
        return { ...requirement, resolvedId: agentId, readiness: 'ready' };
      }
      if (requirement.kind === 'connector') {
        const issue = connectorIssues.get(requirement.capability);
        if (!issue) return { ...requirement, resolvedId: requirement.capability, readiness: 'ready' };
        const blocker: HomeCapabilityBlocker = {
          kind: 'connector',
          capability: requirement.capability,
          code: issue.code,
          message: issue.message,
          recoveryPath: withReturnPath(issue.recoveryPath),
        };
        if (requirement.required) blockers.push(blocker);
        return {
          ...requirement,
          readiness: 'needs_setup',
          recoveryPath: blocker.recoveryPath,
          reason: blocker.message,
        };
      }

      const skill = skills.find((item) => item.name.toLocaleLowerCase() === requirement.capability.toLocaleLowerCase());
      if (skill?.availableForCurrentAgent) {
        return { ...requirement, resolvedId: skill.name, readiness: 'ready' };
      }
      const code = skill?.unavailableReason ? SKILL_CODE[skill.unavailableReason] : 'not_installed';
      const recoveryTab = code === 'not_installed' ? 'marketplace' : 'installed';
      const blocker: HomeCapabilityBlocker = {
        kind: 'skill',
        capability: requirement.capability,
        code,
        message: skill
          ? `${skill.name} is unavailable: ${skill.unavailableReason}.`
          : `${requirement.capability} is not installed.`,
        recoveryPath: withReturnPath(`/skills?tab=${recoveryTab}&q=${encodeURIComponent(requirement.capability)}`),
      };
      if (requirement.required) blockers.push(blocker);
      return {
        ...requirement,
        readiness: 'needs_setup',
        recoveryPath: blocker.recoveryPath,
        reason: blocker.message,
      };
    });

    if (!blockers.length) return { capabilities, preflight: { state: 'ready' } };
    const recoveryActions = [...new Map(blockers.map((blocker) => [blocker.capability, {
      capability: blocker.capability,
      href: blocker.recoveryPath,
    }])).values()];
    return {
      capabilities,
      preflight: {
        state: 'needs_setup',
        blockers,
        recoveryActions,
        ...(options.degradedActionAvailable ? { degradedAction: { mode: 'degraded_start' as const } } : {}),
      },
    };
  }
}
