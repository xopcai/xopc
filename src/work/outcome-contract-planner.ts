import type { UserMessage } from '@earendil-works/pi-ai';

import { getAgentDefaultModelRef, type Config } from '../config/schema.js';
import { resolveModel } from '../providers/index.js';
import {
  completeWithResolvedCredentials,
  resolveModelCallApiKey,
} from '../providers/model-call.js';
import { createLogger } from '../utils/logger.js';
import {
  defineOutcomeContract,
  type OutcomeContractDefinition,
} from './outcome-contract-definition.js';

const log = createLogger('OutcomeContractPlanner');

export interface OutcomeContractPlanningInput {
  objective: string;
  projectContext?: string;
  userContext?: string;
}

export interface OutcomeContractPlanner {
  plan(input: OutcomeContractPlanningInput): Promise<OutcomeContractDefinition>;
}

export interface OutcomeIntentReadiness {
  confidence: number;
  canStartImmediately: boolean;
  blockingDecision?: {
    id: string;
    question: string;
    recommendation: string;
  };
}

const BLOCKING_DECISION_ID = 'approve-execution-boundaries';

export function assessOutcomeIntent(contract: OutcomeContractDefinition): OutcomeIntentReadiness {
  const approvals = contract.approvalRequired.map((item) => item.trim()).filter(Boolean);
  if (approvals.length === 0) {
    return {
      confidence: contract.assumptions.length > 0 ? 0.85 : 0.95,
      canStartImmediately: true,
    };
  }
  const chinese = /[\u3400-\u9fff]/u.test(contract.objective);
  const boundaries = approvals.join(chinese ? '；' : '; ');
  return {
    confidence: 0.75,
    canStartImmediately: false,
    blockingDecision: {
      id: BLOCKING_DECISION_ID,
      question: chinese
        ? `是否同意这些必要执行边界：${boundaries}`
        : `Approve these required execution boundaries: ${boundaries}`,
      recommendation: chinese
        ? '如果这些边界符合你的意图，建议批准并立即开始；否则先修改目标。'
        : 'Approve and start now if these boundaries match your intent; otherwise edit the outcome first.',
    },
  };
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((item): item is { type: 'text'; text: string } =>
      Boolean(item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
        && typeof (item as { text?: unknown }).text === 'string'))
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))].slice(0, max);
}

export function parseOutcomeContractResponse(raw: string): OutcomeContractDefinition | undefined {
  const parsed = parseObject(raw);
  if (!parsed) return undefined;
  const objective = typeof parsed.objective === 'string' ? parsed.objective.trim() : '';
  const deliverables = strings(parsed.deliverables, 8);
  const acceptanceCriteria = strings(parsed.acceptanceCriteria ?? parsed.acceptance_criteria, 12);
  if (!objective || deliverables.length === 0 || acceptanceCriteria.length === 0) return undefined;
  return {
    objective,
    deliverables,
    acceptanceCriteria,
    constraints: strings(parsed.constraints, 10),
    approvalRequired: strings(parsed.approvalRequired ?? parsed.approval_required, 8),
    assumptions: strings(parsed.assumptions, 10),
    risks: strings(parsed.risks, 10),
  };
}

export class ModelOutcomeContractPlanner implements OutcomeContractPlanner {
  constructor(private readonly getConfig: () => Config) {}

  async plan(input: OutcomeContractPlanningInput): Promise<OutcomeContractDefinition> {
    const fallback = defineOutcomeContract(input.objective);
    try {
      const config = this.getConfig();
      const model = resolveModel(getAgentDefaultModelRef(config));
      const prompt = [
        'Define the smallest complete, verifiable contract for the user outcome.',
        'Preserve the user intent. Do not invent requirements or ask for optional preferences.',
        'Acceptance criteria must describe externally checkable finished states, not activities.',
        'List assumptions explicitly. Put only irreversible, external, financial, privacy, or permission decisions in approvalRequired.',
        'Return one JSON object only with keys: objective, deliverables, acceptanceCriteria, constraints, approvalRequired, assumptions, risks.',
        '',
        `User request:\n${input.objective.trim()}`,
        input.projectContext ? `\nProject context:\n${input.projectContext.slice(0, 8_000)}` : '',
        input.userContext ? `\nUser context:\n${input.userContext.slice(0, 8_000)}` : '',
      ].join('\n');
      const message: UserMessage = {
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      const result = await completeWithResolvedCredentials(
        model,
        { messages: [message] },
        {
          apiKey: await resolveModelCallApiKey(model),
          maxTokens: 2_000,
          temperature: 0,
        },
      );
      const planned = parseOutcomeContractResponse(extractText(result.content));
      return planned ? { ...planned, objective: fallback.objective } : fallback;
    } catch (err) {
      log.warn({ err }, 'Outcome contract planning fell back to deterministic criteria');
      return fallback;
    }
  }
}

export class DeterministicOutcomeContractPlanner implements OutcomeContractPlanner {
  async plan(input: OutcomeContractPlanningInput): Promise<OutcomeContractDefinition> {
    return defineOutcomeContract(input.objective);
  }
}
