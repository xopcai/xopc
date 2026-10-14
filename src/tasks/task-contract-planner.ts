import type { UserMessage } from '@earendil-works/pi-ai';

import { getAgentDefaultChatModelConfig } from '../config/schema.js';
import { completeTaskModelCall } from './task-model-call.js';
import { createLogger } from '../utils/logger.js';
import { PERSONAL_WORKER_RESULT_GUIDANCE } from '../personal-agent/communication.js';
import {
  defineTaskContract,
  type TaskContractDefinition,
} from './task-contract-definition.js';

const log = createLogger('TaskContractPlanner');

export interface TaskContractPlanningInput {
  objective: string;
  locale?: 'en' | 'zh';
  taskContext?: string;
  projectContext?: string;
  userContext?: string;
  signal?: AbortSignal;
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
  const plannedCriteria = strings(parsed.acceptanceCriteria, 40);
  const writeBoundary = (criterion: string) => /(?:仅|只)(?:能)?写入|未(?:覆盖|修改).*其他文件|(?:write only|only write)|(?:not|never) (?:overwrite|modify).*other files/i.test(criterion);
  const acceptanceCriteria = plannedCriteria.filter(criterion => !writeBoundary(criterion)).filter(criterion =>
    !(/publish_task_result/.test(criterion) && /调用|使用|提交|返回|检查|验收|call|submit|review/i.test(criterion)
      && !/报告.*(?:说明|描述)|文档.*(?:说明|描述)|(?:report|document).*describe/i.test(criterion)));
  if (Array.isArray(parsed.acceptanceCriteria) && parsed.acceptanceCriteria.length > 40) return undefined;
  if (!objective || expectedOutputs.length === 0 || acceptanceCriteria.length === 0) return undefined;
  return {
    objective,
    expectedOutputs,
    acceptanceCriteria,
    constraints: [...new Set([...strings(parsed.constraints, 10), ...plannedCriteria.filter(writeBoundary)])],
    approvalRequired: strings(parsed.approvalRequired, 8),
    assumptions: strings(parsed.assumptions, 10),
    risks: strings(parsed.risks, 10),
  };
}

export class ModelTaskContractPlanner implements TaskContractPlanner {
  async plan(input: TaskContractPlanningInput): Promise<TaskContractDefinition> {
    const fallback = defineTaskContract(input.objective, input.locale);
    try {
      const models = getAgentDefaultChatModelConfig();
      if (!models) throw new Error('No default task planning model is configured');
      const prompt = [
        'Define the smallest complete, verifiable contract for the user task.',
        'Preserve the user intent. Do not invent requirements or ask for optional preferences.',
        'Acceptance criteria must describe externally checkable finished states, not activities.',
        'Write boundaries and prohibitions on unrelated actions belong in constraints, not criteria requiring proof that no unobserved action ever occurred. Criteria may check the actual delivered output paths and unchanged supplied input bytes. Never remove an explicit scope restriction.',
        'Keep each criterion concise and concrete; do not repeat the full brief. Include all required deliverable conditions without splitting trivial wording into unnecessary items.',
        'Define criteria for the specialist deliverables only. Do not create self-referential criteria about calling publish_task_result, receiving this review, or what a future Personal Agent reply will say. Those are runtime delivery checks, evaluated after completion. Keep source support, calculations, completeness and requested limitations as separate criteria. User-specified files and content remain required.',
        'List assumptions explicitly. Put only irreversible, external, financial, privacy, or permission decisions in approvalRequired.',
        'Return one JSON object only with keys: objective, expectedOutputs, acceptanceCriteria, constraints, approvalRequired, assumptions, risks.',
        input.locale ? `Write all user-facing JSON values in ${input.locale === 'zh' ? 'Simplified Chinese' : 'English'}. Preserve schema keys, identifiers, paths, and proper nouns.`
          : 'Write all user-facing JSON values in the language of the user request, regardless of the language of project or attached context. Preserve schema keys and identifiers.',
        '',
        `User request:\n${input.objective.trim()}`,
        input.taskContext ? `\nUser-provided task context:\n${input.taskContext.replace(PERSONAL_WORKER_RESULT_GUIDANCE, '').trim().slice(0, 16_000)}` : '',
        input.projectContext ? `\nProject context:\n${input.projectContext.slice(0, 8_000)}` : '',
        input.userContext ? `\nUser context:\n${input.userContext.slice(0, 8_000)}` : '',
      ].join('\n');
      const message: UserMessage = {
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      const result = await completeTaskModelCall(
        models,
        { messages: [message] },
        {
          maxTokens: 4_000,
          temperature: 0,
          signal: input.signal,
        },
        { operation: 'task.plan_contract' },
      );
      const planned = parseTaskContractResponse(extractText(result.content));
      if (!planned) throw new Error('Task planning response did not contain a verifiable contract');
      return { ...planned, objective: fallback.objective };
    } catch (err) {
      log.warn({ err }, 'Task contract planning fell back to deterministic criteria');
      return fallback;
    }
  }
}
