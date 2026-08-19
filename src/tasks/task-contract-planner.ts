import type { UserMessage } from '@earendil-works/pi-ai';

import { getAgentDefaultModelRef, type Config } from '../config/schema.js';
import { resolveModel } from '../providers/index.js';
import {
  completeWithResolvedCredentials,
  resolveModelCallApiKey,
} from '../providers/model-call.js';
import { createLogger } from '../utils/logger.js';
import {
  defineTaskContract,
  type TaskContractDefinition,
} from './task-contract-definition.js';

const log = createLogger('TaskContractPlanner');

export interface TaskContractPlanningInput {
  objective: string;
  taskContext?: string;
  projectContext?: string;
  userContext?: string;
}

export interface TaskContractPlanner {
  plan(input: TaskContractPlanningInput): Promise<TaskContractDefinition>;
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

export function parseTaskContractResponse(raw: string): TaskContractDefinition | undefined {
  const parsed = parseObject(raw);
  if (!parsed) return undefined;
  const objective = typeof parsed.objective === 'string' ? parsed.objective.trim() : '';
  const expectedOutputs = strings(parsed.expectedOutputs, 8);
  const acceptanceCriteria = strings(parsed.acceptanceCriteria, 12);
  if (!objective || expectedOutputs.length === 0 || acceptanceCriteria.length === 0) return undefined;
  return {
    objective,
    expectedOutputs,
    acceptanceCriteria,
    constraints: strings(parsed.constraints, 10),
    approvalRequired: strings(parsed.approvalRequired, 8),
    assumptions: strings(parsed.assumptions, 10),
    risks: strings(parsed.risks, 10),
  };
}

export class ModelTaskContractPlanner implements TaskContractPlanner {
  constructor(private readonly getConfig: () => Config) {}

  async plan(input: TaskContractPlanningInput): Promise<TaskContractDefinition> {
    const fallback = defineTaskContract(input.objective);
    try {
      const config = this.getConfig();
      const model = resolveModel(getAgentDefaultModelRef(config));
      const prompt = [
        'Define the smallest complete, verifiable contract for the user task.',
        'Preserve the user intent. Do not invent requirements or ask for optional preferences.',
        'Acceptance criteria must describe externally checkable finished states, not activities.',
        'List assumptions explicitly. Put only irreversible, external, financial, privacy, or permission decisions in approvalRequired.',
        'Return one JSON object only with keys: objective, expectedOutputs, acceptanceCriteria, constraints, approvalRequired, assumptions, risks.',
        '',
        `User request:\n${input.objective.trim()}`,
        input.taskContext ? `\nUser-provided task context:\n${input.taskContext.slice(0, 16_000)}` : '',
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
      const planned = parseTaskContractResponse(extractText(result.content));
      return planned ? { ...planned, objective: fallback.objective } : fallback;
    } catch (err) {
      log.warn({ err }, 'Task contract planning fell back to deterministic criteria');
      return fallback;
    }
  }
}
