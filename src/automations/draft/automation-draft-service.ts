import { type UserMessage } from '@earendil-works/pi-ai/compat';

import type { Config } from '../../config/schema.js';
import { resolveModel } from '../../providers/index.js';
import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import { createLogger } from '../../utils/logger.js';
import { resolveDraftModelRef } from '../../workflows/draft/workflow-draft-service.js';
import {
  buildAutomationDraftPrompt,
  buildAutomationDraftRepairPrompt,
  buildAutomationRunRepairPrompt,
  buildAutomationRunRepairRetryPrompt,
  type AutomationDraftRepairIssue,
} from './automation-draft-prompt.js';
import type {
  AutomationDraftResponse,
  AutomationRepairDraftResponse,
  CreateAutomationDraftRequest,
  CreateAutomationRepairDraftRequest,
} from './automation-draft.types.js';
import {
  buildAutomationDraftResponse,
  parseGeneratedAutomationDraft,
  parseGeneratedAutomationRepairDraft,
} from './automation-draft-validator.js';

const log = createLogger('AutomationDraft');
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

export interface AutomationDraftServiceOptions {
  config: Config;
  maxRepairAttempts?: number;
}

export class AutomationDraftService {
  constructor(private readonly options: AutomationDraftServiceOptions) {}

  async createDraft(request: CreateAutomationDraftRequest, signal?: AbortSignal): Promise<AutomationDraftResponse> {
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error('prompt is required');

    const modelRef = resolveDraftModelRef(this.options.config, request.agentId);
    const model = resolveModel(modelRef);
    const maxRepairAttempts = this.options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
    let messageContent = buildAutomationDraftPrompt({ prompt, language: request.language });
    let lastText = '';
    let lastIssues: AutomationDraftRepairIssue[] = [];

    for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
      const userMsg: UserMessage = {
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      };
      const result = await completeWithResolvedCredentials(
        model,
        { messages: [userMsg] },
        { maxTokens: 2048, temperature: attempt === 0 ? 0.2 : 0.1, signal },
      );
      lastText = extractText(result);
      try {
        const draft = parseGeneratedAutomationDraft(lastText);
        return buildAutomationDraftResponse(draft, attempt);
      } catch (err) {
        lastIssues = [{
          source: 'validation',
          severity: 'error',
          message: err instanceof Error ? err.message : String(err),
        }];
      }

      if (attempt >= maxRepairAttempts) break;
      log.warn(
        { modelRef, attempt: attempt + 1, issueCount: lastIssues.length, preview: lastText.slice(0, 500) },
        'Automation draft validation failed; asking model to repair',
      );
      messageContent = buildAutomationDraftRepairPrompt({
        prompt,
        language: request.language,
        previousOutput: lastText,
        issues: lastIssues,
      });
    }

    const message = `Unable to generate a valid automation draft after ${maxRepairAttempts + 1} attempts`;
    log.warn({ modelRef, issues: lastIssues, preview: lastText.slice(0, 500) }, message);
    throw new Error(message);
  }

  async createRepairDraft(
    request: CreateAutomationRepairDraftRequest,
    signal?: AbortSignal,
  ): Promise<AutomationRepairDraftResponse> {
    const modelRef = resolveDraftModelRef(this.options.config, request.agentId);
    const model = resolveModel(modelRef);
    const maxRepairAttempts = this.options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
    let messageContent = buildAutomationRunRepairPrompt({
      language: request.language,
      automation: request.automation,
      run: request.run,
      events: request.events,
    });
    let lastText = '';
    let lastIssues: AutomationDraftRepairIssue[] = [];

    for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
      const userMsg: UserMessage = {
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      };
      const result = await completeWithResolvedCredentials(
        model,
        { messages: [userMsg] },
        { maxTokens: 2048, temperature: attempt === 0 ? 0.15 : 0.05, signal },
      );
      lastText = extractText(result);
      try {
        return parseGeneratedAutomationRepairDraft(lastText, attempt);
      } catch (err) {
        lastIssues = [{
          source: 'validation',
          severity: 'error',
          message: err instanceof Error ? err.message : String(err),
        }];
      }

      if (attempt >= maxRepairAttempts) break;
      log.warn(
        { modelRef, attempt: attempt + 1, issueCount: lastIssues.length, preview: lastText.slice(0, 500) },
        'Automation repair draft validation failed; asking model to repair',
      );
      messageContent = buildAutomationRunRepairRetryPrompt({
        language: request.language,
        previousOutput: lastText,
        issues: lastIssues,
      });
    }

    const message = `Unable to generate a valid automation repair draft after ${maxRepairAttempts + 1} attempts`;
    log.warn({ modelRef, issues: lastIssues, preview: lastText.slice(0, 500) }, message);
    throw new Error(message);
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
