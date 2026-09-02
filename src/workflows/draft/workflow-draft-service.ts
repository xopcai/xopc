import { type UserMessage } from '@earendil-works/pi-ai/compat';

import { resolveModelSelector } from '../../config/agent-model-intents.js';
import { getAgentDefaultModelRef } from '../../config/schema.js';
import type { Config } from '../../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../../providers/index.js';
import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import { createLogger } from '../../utils/logger.js';

import {
  buildWorkflowDraftPrompt,
  buildWorkflowDraftRepairPrompt,
  type WorkflowDraftRepairIssue,
} from './workflow-draft-prompt.js';
import type { CreateWorkflowDraftRequest, WorkflowDraftResponse } from './workflow-draft.types.js';
import { buildWorkflowDraftResponse, parseGeneratedWorkflowDraft } from './workflow-draft-validator.js';

const log = createLogger('WorkflowDraft');
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

export interface WorkflowDraftServiceOptions {
  config: Config;
  maxRepairAttempts?: number;
}

export class WorkflowDraftService {
  constructor(private readonly options: WorkflowDraftServiceOptions) {}

  async createDraft(request: CreateWorkflowDraftRequest, signal?: AbortSignal): Promise<WorkflowDraftResponse> {
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error('prompt is required');
    const modelRef = resolveDraftModelRef(this.options.config, request.agentId);
    const model = resolveModel(modelRef);
    const maxRepairAttempts = this.options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
    let messageContent = buildWorkflowDraftPrompt({
      prompt,
      language: request.language,
      mode: request.mode ?? (request.existingGraph ? 'improve' : 'create'),
      existingGraph: request.existingGraph,
      constraints: request.constraints,
    });
    let lastIssues: WorkflowDraftRepairIssue[] = [];
    let lastText = '';

    for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
      const userMsg: UserMessage = {
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      };
      const result = await completeWithResolvedCredentials(
        model,
        { messages: [userMsg] },
        { maxTokens: 4096, temperature: attempt === 0 ? 0.25 : 0.1, signal: signal as AbortSignal },
      );
      lastText = extractText(result);
      try {
        const draft = parseGeneratedWorkflowDraft(lastText);
        const response = buildWorkflowDraftResponse(draft, request.constraints);
        const blockingIssues = getBlockingDraftIssues(response);
        if (blockingIssues.length === 0) {
          return { ...response, repairAttempts: attempt };
        }
        lastIssues = blockingIssues;
      } catch (err) {
        lastIssues = [{
          source: 'parse',
          severity: 'error',
          code: 'invalid_model_output',
          message: err instanceof Error ? err.message : String(err),
        }];
      }

      if (attempt >= maxRepairAttempts) break;
      log.warn(
        { modelRef, attempt: attempt + 1, issueCount: lastIssues.length, preview: lastText.slice(0, 500) },
        'Workflow draft validation failed; asking model to repair',
      );
      messageContent = buildWorkflowDraftRepairPrompt({
        prompt,
        language: request.language,
        constraints: request.constraints,
        previousOutput: lastText,
        issues: lastIssues,
      });
    }

    const message = `Unable to generate a valid workflow draft after ${maxRepairAttempts + 1} attempts: ${formatRepairIssues(lastIssues)}`;
    log.warn({ modelRef, issues: lastIssues, preview: lastText.slice(0, 500) }, message);
    throw new Error(message);
  }
}

export function resolveDraftModelRef(config: Config, agentId: string): string {
  try {
    return resolveModelSelector(config, agentId, 'reasoning');
  } catch {
    return getAgentDefaultModelRef(config) ?? getDefaultModelSync(config);
  }
}

function extractText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
        return String((item as { text?: string }).text ?? '');
      }
      return '';
    }).join('');
  }
  return '';
}

function getBlockingDraftIssues(response: WorkflowDraftResponse): WorkflowDraftRepairIssue[] {
  const validationIssues: WorkflowDraftRepairIssue[] = [
    ...response.validation.errors.map((issue) => ({
      source: 'validation' as const,
      severity: 'error' as const,
      code: issue.code,
      message: issue.message,
    })),
    ...response.validation.warnings.map((issue) => ({
      source: 'validation' as const,
      severity: 'warning' as const,
      code: issue.code,
      message: issue.message,
    })),
  ];
  const lintIssues = response.lint
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      source: 'lint' as const,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
    }));
  return [...validationIssues, ...lintIssues];
}

function formatRepairIssues(issues: WorkflowDraftRepairIssue[]): string {
  if (issues.length === 0) return 'unknown validation failure';
  return issues.slice(0, 5).map((issue) => `${issue.source}:${issue.code}: ${issue.message}`).join('; ');
}
