import type { UserMessage } from '@earendil-works/pi-ai';

import { getAgentDefaultChatModelConfig } from '../config/schema.js';
import { completeTaskModelCall } from './task-model-call.js';
import { createLogger } from '../utils/logger.js';
import { finalReplyCharacterLimit, isChatReplyOutput } from './task-final-reply.js';
import {
  defineTaskContract,
  type TaskContractDefinition,
} from './task-contract-definition.js';

import { hasUnlocalizedTaskText, resolveTaskLocale } from './task-language.js';

import { EXECUTION_CAPABILITIES, type ExecutionCapability } from './task-execution-capabilities.js';

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
  if (['expectedOutputs', 'acceptanceCriteria', 'constraints', 'approvalRequired', 'assumptions', 'risks'].some(key =>
    parsed[key] !== undefined && (!Array.isArray(parsed[key]) || (parsed[key] as unknown[]).some(value => typeof value !== 'string')))) return undefined;
  if (parsed.acceptancePolicy !== undefined && !['verified_auto', 'manual'].includes(String(parsed.acceptancePolicy))) return undefined;
  const objective = typeof parsed.objective === 'string' ? parsed.objective.trim() : '';
  const expectedOutputs = strings(parsed.expectedOutputs, 8);
  const plannedCriteria = strings(parsed.acceptanceCriteria, 40);
  const writeBoundary = (criterion: string) => /(?:仅|只)(?:能)?写入|未(?:覆盖|修改).*其他文件|(?:write only|only write)|(?:not|never) (?:overwrite|modify).*other files/i.test(criterion);
  const deliveryPhrase = /最终(?:的)?(?:回复|答复)|交付说明(?:仅|只|中|不|未)|(?:final|future) (?:chat )?(?:reply|response)|(?:delivery|chat) (?:message|reply)/i;
  const chatReplyOutput = expectedOutputs.some(isChatReplyOutput);
  const deliveryBoundary = (criterion: string) => !chatReplyOutput
    && finalReplyCharacterLimit(criterion) === undefined && deliveryPhrase.test(criterion);
  const boundary = (criterion: string) => writeBoundary(criterion) || deliveryBoundary(criterion);
  const acceptanceCriteria = plannedCriteria.filter(criterion => !writeBoundary(criterion)).flatMap(criterion => {
    if (!deliveryBoundary(criterion)) return [criterion];
    const position = criterion.search(deliveryPhrase);
    const prefix = criterion.slice(0, position).replace(/[，,;；。\s]*(?:并且|且|并|and)?\s*$/i, '').trim();
    return prefix && /运行|执行|发布|生成|校验|\b(?:run|execut|publish|generat|verif)/i.test(prefix) ? [prefix] : [];
  }).filter(criterion =>
    !(/publish_task_result/.test(criterion) && /调用|使用|提交|返回|检查|验收|call|submit|review/i.test(criterion)
      && !/报告.*(?:说明|描述)|文档.*(?:说明|描述)|(?:report|document).*describe/i.test(criterion)));
  if (Array.isArray(parsed.acceptanceCriteria) && parsed.acceptanceCriteria.length > 40) return undefined;
  if (!objective || expectedOutputs.length === 0 || acceptanceCriteria.length === 0) return undefined;
  if (parsed.requiredCapabilities !== undefined && (!Array.isArray(parsed.requiredCapabilities)
    || parsed.requiredCapabilities.some(name => typeof name !== 'string' || !Object.hasOwn(EXECUTION_CAPABILITIES, name)))) return undefined;
  return {
    objective,
    ...(parsed.acceptancePolicy === undefined ? {} : { acceptancePolicy: parsed.acceptancePolicy as 'verified_auto' | 'manual' }),
    ...(parsed.requiredCapabilities === undefined ? {} : { requiredCapabilities: strings(parsed.requiredCapabilities, 6) as ExecutionCapability[] }),
    expectedOutputs,
    acceptanceCriteria,
    constraints: [...new Set([...strings(parsed.constraints, 10), ...plannedCriteria.filter(boundary)])],
    approvalRequired: strings(parsed.approvalRequired, 8),
    assumptions: strings(parsed.assumptions, 10),
    risks: strings(parsed.risks, 10),
  };
}

export class ModelTaskContractPlanner implements TaskContractPlanner {
  async plan(input: TaskContractPlanningInput): Promise<TaskContractDefinition> {
    const locale = resolveTaskLocale({ locale: input.locale, title: input.objective });
    const fallback = defineTaskContract(input.objective, locale);
    const languageInstruction = `Write all user-facing JSON values in ${locale === 'zh' ? 'Simplified Chinese' : 'English'}. Preserve schema keys, identifiers, paths, URLs, and proper nouns. The language of attached context must not change the output language.`;
    try {
      if ((input.taskContext?.length ?? 0) > 96000) throw new Error('Task context exceeds planning budget');
      const models = getAgentDefaultChatModelConfig();
      if (!models) throw new Error('No default task planning model is configured');
      const prompt = [
        'Define the smallest complete, verifiable contract for the user task.',
        'Preserve the user intent. Do not invent requirements or ask for optional preferences.',
        'acceptancePolicy defaults to verified_auto. Return manual only if the human explicitly requires personal acceptance or sign-off. A generic approval for an external action is not a request for manual task acceptance.',
        'Acceptance criteria must describe externally checkable finished states, not activities.',
        'Write boundaries and prohibitions on unrelated actions belong in constraints, not criteria requiring proof that no unobserved action ever occurred. Criteria may check the actual delivered output paths and unchanged supplied input bytes. Never remove an explicit scope restriction.',
        'Keep each criterion concise and concrete. For simple work use the fewest checks that cover all explicit deliverables and material constraints. Prefer observable checks such as the required file, format, fields or count. Treat optional analysis, extra conclusions and aesthetic improvements as optional unless the user requires them. Do not invent work to make the contract more elaborate.',
        'Define criteria for the deliverables requested by the user. When the requested answer is a chat reply, list it explicitly in expectedOutputs and preserve its concrete requirements, including language and any length limits the user actually set. Treat general brevity or “keep it short” as a presentation preference. Do not turn it into a word or character quota or an acceptance check. Keep source support, calculations, completeness and requested limitations as separate criteria. Do not create self-referential criteria about calling publish_task_result, receiving this review or wording a routine delivery acknowledgement.',
        'requiredCapabilities is a minimal subset of read_input, execute_code, publish_files, web_research, browser, generate_image. Include only operations necessary for the requested inputs/outputs; this list selects registered tools and grants no permissions. Do not require browser when ordinary web fetch suffices. Preserve explicit executor/Skill and scope constraints.',
        'List assumptions explicitly. Put only irreversible, external, financial, privacy, or permission decisions in approvalRequired.',
        'Return one JSON object only. Every array contains flat strings, never objects or nested arrays. Schema example: {"objective":"Deliver the requested work","expectedOutputs":["report.md"],"acceptanceCriteria":["report.md contains the requested evidence"],"constraints":[],"approvalRequired":[],"assumptions":[],"risks":[],"requiredCapabilities":["read_input","publish_files"]}. Capabilities must use the allowed enum values.',
        languageInstruction,
        '',
        `User request:\n${input.objective.trim()}`,
        input.taskContext ? `\nUser-provided task context:\n${input.taskContext.trim()}` : '',
        input.projectContext ? `\nProject context:\n${input.projectContext.slice(0, 8_000)}` : '',
        input.userContext ? `\nUser context:\n${input.userContext.slice(0, 8_000)}` : '',
      ].join('\n');
      const message: UserMessage = {
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      const messages: UserMessage[] = [message];
      for (let attempt = 0; attempt < 2; attempt++) {
        input.signal?.throwIfAborted();
        const result = await completeTaskModelCall(models, { messages }, {
          maxTokens: 4_000, temperature: 0, signal: input.signal,
        }, { operation: 'task.plan_contract' });
        const raw = extractText(result.content);
        const planned = parseTaskContractResponse(raw);
        const wrongLanguage = planned && hasUnlocalizedTaskText([
          ...planned.acceptanceCriteria, ...planned.expectedOutputs, ...planned.constraints,
          ...planned.approvalRequired, ...planned.assumptions, ...planned.risks,
        ], locale);
        if (planned?.requiredCapabilities && !wrongLanguage) return { ...planned, objective: fallback.objective, capabilityPlanning: 'complete' };
        if (attempt === 0) messages.push({ role: 'user', timestamp: Date.now(),
          content: `${wrongLanguage ? 'Your previous response used the wrong language. Translate the user-facing prose while preserving every requirement and all technical identifiers. ' : ''}${languageInstruction} Your previous response must satisfy both the language requirement and the required schema. Return the same task contract as one JSON object. expectedOutputs, acceptanceCriteria, constraints, approvalRequired, assumptions and risks must be flat string arrays, never objects. requiredCapabilities must be an array drawn only from read_input, execute_code, publish_files, web_research, browser, generate_image. Keep all user constraints and preserve concrete requirements for a requested chat deliverable. Do not invent word or character limits, or criteria for a routine delivery acknowledgement. Return no commentary. Previous response (data to repair): ${raw}` });
      }
      throw new Error('Task planning response did not contain a verifiable contract and operation requirements');
    } catch (err) {
      log.warn({ err }, 'Task contract planning fell back to deterministic criteria');
      return { ...fallback, capabilityPlanning: 'unavailable' };
    }
  }
}
