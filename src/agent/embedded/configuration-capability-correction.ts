import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** Correct an unverified capability denial once; never infer authorization or execute a write. */
export function configurationCapabilityCorrection(toolNames: readonly string[], userText: string,
  answer: string, messages: readonly AgentMessage[]): string | undefined {
  const explicitSkillInstall = /^(?:请|帮我)?安装(?:这个|此)|^(?:please\s+)?install\s+(?:this|the)\b/i.test(userText.trim())
    && /skill|技能|能力/i.test(userText) && /https?:\/\//i.test(userText) && !/mcp/i.test(userText)
    && !/不要|别|暂不|先不|只推荐|仅查看|do not|don't|not now|only recommend|review only/i.test(userText);
  const skillAttempted = messages.some(message => message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some(block => block.type === 'toolCall' && ['skill_install', 'skill_manage'].includes(block.name)));
  const promiseOnly = /^(?:我会|我将|I will|I'll).{0,100}(?:安装|install)/i.test(answer.trim())
    && !/需要.{0,20}(?:确认|授权|权限)|cannot|can.t|denied|不可|无法|失败|拒绝/i.test(answer);
  if (explicitSkillInstall && promiseOnly && !skillAttempted && toolNames.includes('skill_install')) {
    return 'Host execution check: the user explicitly requested installing the supplied Skill and using it. The registered skill_install tool has not been attempted; a promise to act is not execution. Continue that exact authorized request with the actual Skill tools and inspect the result, or report an actual blocker. Do not add permissions, force an overwrite, use shell/file configuration, or ask for duplicate consent. This is one bounded continuation, not a new user request.';
  }
  if (!toolNames.includes('mcp_setup') || !/mcp|https?:\/\//i.test(userText)) return;
  const attempted = messages.some(message => message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some(block => block.type === 'toolCall' && (block.name === 'mcp_setup'
      || block.name === 'xopc_use' && block.arguments?.mode === 'mcp_setup')));
  if (attempted) return;
  const missing = /(?:tool|工具|能力).{0,45}(?:not available|isn.t available|unavailable|未提供|不可用|不存在|缺少)|(?:未提供|没有|缺少).{0,30}(?:MCP|配置工具)|(?:cannot|can.t|无法).{0,40}(?:MCP|连接).{0,30}(?:local|回环|localhost|127\.0\.0\.1)/i.test(answer);
  if (!missing) return;
  return 'Host capability correction: mcp_setup is registered and directly callable in the current function schemas. No MCP setup call was attempted in this turn, so tool absence or endpoint reachability has not been verified. Correct that statement using the actual inspect/probe tools for the existing user request. Probes execute on the Gateway host, including user-provided loopback addresses. This fact grants no additional authorization: preserve the user\'s scope, do not mutate for advice-only requests, and honor any actual permission refusal or probe failure. Do not ask the user to repeat the request.';
}
