import { taskRunResultKind, type TaskRunReceipt } from '@xopcai/gateway-contract';

import { parseAgentRunError, parseStructuredAgentRunError } from '@/features/chat/messages/agent-run-error-parser';
import { serviceDisplayName } from '@/features/settings/models-hub/capability-presentation';
import { messages } from '@/i18n/messages';

type Language = 'zh' | 'en';

export type TaskRunIssue = {
  title: string;
  description?: string;
  action?: { label: string; href: string };
};

const modelsHref = '/settings/capabilities/models';
const diagnosticCodes = new Set([
  'provider_setup_required', 'provider_auth_invalid', 'rate_limit', 'timeout', 'provider_connection_error',
  'billing', 'model_quota_exhausted', 'platform_token_limit_exceeded', 'credit_budget_exhausted',
  'xopc_quota_exhausted', 'xopc_platform_limit', 'xopc_credit_budget_exhausted', 'unknown', 'format',
  'task_model_unavailable',
]);
const errorHeader = /^(?:No API key found for |OAuth refresh failed for |[a-z]*Error:|HTTP [45]\d{2}\b|[45]\d{2}(?::| (?:Unauthorized|Forbidden|Too Many Requests|Bad Request|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b)|invalid_api_key\b|insufficient_quota\b)/i;
const runFailure = /^(?:(?:fetch|connection) failed\b|Connection error[.!]?\s*$|(?:Request|Agent run) timed out\b|Assistant turn failed\b)/i;

function runDiagnostic(text: string) {
  const value = text.trim().replace(/^Error:\s+/, '');
  if (value.startsWith('{')) {
    const payload = parseStructuredAgentRunError(value);
    if (payload && (diagnosticCodes.has(payload.code) || diagnosticCodes.has(payload.kind) || /(?:error|failed)$/.test(payload.kind))) return payload;
    // Workbench previews may contain only the start of an older serialized error.
    const code = /^\{\s*"(?:kind|code)"\s*:\s*"([^"]+)"/.exec(value)?.[1];
    if (!payload && code && diagnosticCodes.has(code)) return { code, kind: code, provider: undefined };
  }
  return errorHeader.test(text.trim()) || runFailure.test(value) || /\n[ \t]+at\s+(?:async\s+)?\S+/.test(value)
    ? parseAgentRunError(value) : null;
}

function taskRunIssue(text: string | undefined, language: Language, failureCode?: string): TaskRunIssue | undefined {
  const diagnostic = text ? runDiagnostic(text) : null;
  const code = diagnostic ? (diagnosticCodes.has(diagnostic.code) ? diagnostic.code : diagnostic.kind) : failureCode;
  const zh = language === 'zh';
  const m = messages(language).chat;
  const providerId = diagnostic?.provider;
  const provider = providerId && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(providerId) && !/^sk-/i.test(providerId)
    ? serviceDisplayName(providerId, providerId === 'qwen-token-plan-cn' ? 'Alibaba Bailian Subscription (China)' : providerId, zh)
    : (zh ? '当前任务使用的模型服务商' : 'the model provider used by this task');
  const modelSettings = { label: zh ? '打开模型设置' : 'Open model settings', href: modelsHref };
  switch (code) {
    case 'provider_setup_required':
      return {
        title: m.providerSetupRequiredTitle,
        description: zh ? `本次任务缺少 ${provider} 的连接凭证。请在模型设置中完成配置，再回到工作台重试。`
          : `Credentials for ${provider} are missing. Set them up in model settings, then return to the workbench and retry.`,
        action: modelSettings,
      };
    case 'provider_auth_invalid':
      return {
        title: zh ? '模型服务商认证失败' : 'Model provider authentication failed',
        description: zh ? `${provider} 拒绝了当前凭证。请重新登录或更新 API 密钥，再重试。`
          : `${provider} rejected the current credentials. Sign in again or update the API key, then retry.`,
        action: modelSettings,
      };
    case 'task_model_unavailable':
      return { title: zh ? '没有可用于后台任务的模型' : 'No model is available for background tasks', action: modelSettings };
    case 'provider_connection_error':
      return {
        title: m.agentRunErrorConnectionTitle,
        description: zh ? '本次执行中断。请稍后重试；如果已经执行过外部操作，先核对实际结果。'
          : 'The run was interrupted. Try again later. If it already took an external action, check the outcome first.',
      };
    case 'rate_limit':
      return { title: m.agentRunErrorRateLimitTitle, description: m.agentRunErrorRateLimitBody };
    case 'timeout':
      return { title: m.agentRunErrorTimeoutTitle, description: m.agentRunErrorTimeoutBody };
    case 'billing':
      return { title: m.agentRunErrorBillingTitle, description: m.agentRunErrorBillingBody };
    case 'xopc_quota_exhausted':
    case 'model_quota_exhausted':
      return { title: m.xopcQuotaExhaustedTitle, description: m.xopcQuotaExhaustedBody, action: modelSettings };
    case 'xopc_platform_limit':
    case 'platform_token_limit_exceeded':
      return { title: m.xopcPlatformLimitTitle, description: m.xopcPlatformLimitBody, action: modelSettings };
    case 'xopc_credit_budget_exhausted':
    case 'credit_budget_exhausted':
      return {
        title: m.creditBudgetExhaustedTitle,
        description: m.creditBudgetExhaustedBody,
        action: { label: m.creditBudgetSettingsCta, href: '/settings/agent-defaults?panel=runtime' },
      };
    case 'tool_outcome_unconfirmed':
    case 'execution_interrupted':
      return {
        title: zh ? '需要确认上次操作结果' : 'Confirm the outcome of the previous run',
        description: zh ? '重试前请确认上次执行是否已产生外部变更。' : 'Before retrying, check whether the previous run made any external changes.',
      };
    case 'acceptance_incomplete':
      return {
        title: zh ? '结果尚未达到验收要求' : 'The result does not yet meet the requirements',
        description: zh ? '请查看尚待完成的事项和已有依据，确认还需要补做什么。' : 'Review the remaining work and available evidence to see what still needs attention.',
      };
    case 'empty_agent_run':
      return { title: zh ? '本次执行没有生成可查看的结果' : 'This run did not produce a result to review' };
    case 'dispatch_failed':
      return { title: zh ? '任务未能开始执行' : 'The task could not start' };
    default:
      return diagnostic ? { title: zh ? '本次执行未完成' : 'This run did not complete' } : undefined;
  }
}

const repairMessages: Record<string, [string, string]> = {
  'The required evidence-linked research result is missing.': [
    '缺少可核对的来源和结论，暂时无法核验结果。',
    'There are no source-backed findings to verify yet.',
  ],
  'The requested chat reply is missing.': [
    '还没有生成可在对话中查看的答复。',
    'The reply for the conversation is still missing.',
  ],
  'Requirements changed after review.': [
    '验收后任务要求有更新，需要按最新要求重新核验。',
    'The requirements changed after review. The result needs to be checked against the latest requirements.',
  ],
  'Review every current acceptance criterion;': [
    '还有验收条件尚未核验。',
    'Some acceptance criteria have not been checked.',
  ],
  'No evidence-linked verification result was submitted.': [
    '暂时缺少可核对的依据。',
    'There is no evidence to check this criterion yet.',
  ],
  'Criterion omitted by reviewer.': ['本次核验未覆盖此项。', 'This criterion was not checked.'],
  'Instruction omitted by reviewer.': ['本次核验未覆盖这项补充要求。', 'This additional requirement was not checked.'],
  'Review unavailable.': ['本次未能完成核验。', 'Verification could not be completed.'],
  'Directions added during execution still need verification.': [
    '执行期间补充的要求还有待核验。',
    'Requirements added during the run still need verification.',
  ],
  'Default criteria were not expanded into concrete acceptance items;': [
    '验收条件还不够具体，暂时无法逐项确认完成情况。',
    'The criteria are too broad to confirm which requirements are met.',
  ],
  'Evidence is insufficient.': ['现有依据不足。', 'The available evidence is insufficient.'],
};

function readableRepairText(text: string, language: Language): string {
  const fileGap = /^(Published file missing|Publication changed after review):\s*(.+?)\. (?:Republish from the existing workspace output|Review the final version)\.$/.exec(text);
  if (fileGap) {
    const [, kind, title] = fileGap;
    const name = /^Selected artifact\s+/.test(title) ? undefined : title;
    if (kind === 'Published file missing') {
      return language === 'zh' ? (name ? `暂时无法打开交付文件「${name}」，需要重新发布。` : '有交付文件缺失，需要重新发布。')
        : (name ? `“${name}” is unavailable and needs to be published again.` : 'A deliverable is missing and needs to be published again.');
    }
    return language === 'zh' ? `交付文件「${title}」有更新，需要核验最新版本。` : `“${title}” changed after review. Check the latest version.`;
  }
  const content = text.replace(/^(?:Criterion \d+|Instruction \d+|Claim [\w.-]+):\s*/, '');
  const knownMessage = Object.entries(repairMessages).find(([prefix]) => content.startsWith(prefix));
  if (knownMessage) return knownMessage[1][language === 'zh' ? 0 : 1];
  return language === 'zh' && content.endsWith(' Evidence is insufficient.')
    ? `${content.slice(0, -' Evidence is insufficient.'.length).replace(/([。！？])\.$/, '$1')} 现有依据不足。`
    : content.replace(/([。！？])\.(?=\s|$)/g, '$1');
}

/** Format display text from older receipts and workbench previews without rewriting result content. */
export function taskTextForDisplay(text: string | undefined, language: Language): string {
  if (!text?.trim()) return '';
  return taskRunIssue(text, language)?.title ?? readableRepairText(text.trim(), language);
}

export function presentTaskRunResult(receipt: TaskRunReceipt, language: Language, terminalMessage?: string) {
  const zh = language === 'zh';
  const resultKind = taskRunResultKind(receipt);
  const failureCode = receipt.status === 'failed' ? receipt.failure?.code : undefined;
  const summaryIssue = taskRunIssue(receipt.summary, language);
  const recoveryRequiresReview = failureCode === 'tool_outcome_unconfirmed' || failureCode === 'execution_interrupted';
  const issue = recoveryRequiresReview ? taskRunIssue(undefined, language, failureCode)
    : summaryIssue ?? taskRunIssue(receipt.status === 'failed' ? terminalMessage : undefined, language,
      resultKind === 'verification_unverified' ? undefined : failureCode);
  const summary = summaryIssue || failureCode === 'empty_agent_run' ? '' : readableRepairText(receipt.summary.trim(), language);
  const remainingWork = [...new Set(receipt.remainingWork.map(item => taskTextForDisplay(item, language)).filter(Boolean))];
  const nextAction = taskTextForDisplay(receipt.nextAction, language)
    || (!issue?.description ? taskTextForDisplay(receipt.failure?.recoveryAction, language) : '');
  const status = receipt.status === 'cancelled' ? (zh ? '本次执行已取消。' : 'This run was canceled.')
    : resultKind === 'verification_failed' ? (zh ? '已有执行结果，验收未通过。' : 'A result is available. It did not pass acceptance.')
      : resultKind === 'verification_unverified' ? (zh ? '验收尚未完成，仍有要求待核验。' : 'Acceptance is pending verification.')
      : resultKind === 'execution_failed' || receipt.completionVerdict === 'not_achieved'
      ? (zh ? '本次执行未完成。' : 'This run did not complete.')
      : receipt.completionVerdict === 'achieved'
        ? (zh ? '执行报告已达成目标，请结合依据验收。' : 'The run reports that it met the goal. Review the evidence before accepting.')
        : receipt.completionVerdict === 'partial'
          ? (zh ? '已有阶段性结果，仍有事项需要确认或完成。' : 'A partial result is available. Some work still needs review or completion.')
          : (zh ? '本次执行已结束，请查看结果和依据。' : 'The run ended. Review the result and supporting evidence.');
  return { issue, summary, remainingWork, nextAction, status };
}
