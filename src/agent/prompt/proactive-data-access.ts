import type { PromptRole } from './types.js';

export interface ProactiveDataAccessParams {
  agentId?: string;
  defaultAgentId?: string;
  promptRole?: PromptRole;
  toolNames: readonly string[];
}

/**
 * Proactive problem-solving across external capabilities applies to the Personal Agent
 * and the default (`main`) agent, keeping narrow specialist agents scoped to their own role.
 */
export function isProactiveDataAccessAgent(params: Pick<ProactiveDataAccessParams, 'agentId' | 'defaultAgentId' | 'promptRole'>): boolean {
  if (params.promptRole === 'personal') return true;
  const targetDefault = params.defaultAgentId?.trim() || 'main';
  return Boolean(params.agentId && params.agentId.trim() === targetDefault);
}

/**
 * Build principle-driven agency and judgment guidance for `main` (Personal Agent carries
 * its delegation-oriented counterpart in `src/personal-agent/prompts.ts`).
 */
export function buildProactiveDataAccessGuide(params: ProactiveDataAccessParams): string {
  if (params.promptRole === 'personal') return '';
  if (!isProactiveDataAccessAgent(params)) return '';

  const tools = new Set(params.toolNames.map(name => name.trim().toLowerCase()).filter(Boolean));
  const hasToolSearch = tools.has('tool_search');
  const hasRequireConnection = tools.has('xopc_require_connection');
  const hasMcpSetup = tools.has('mcp_setup');
  const hasBrowser = tools.has('browser_use');

  if (!hasToolSearch && !hasRequireConnection && !hasMcpSetup && !hasBrowser) return '';

  const capabilities: string[] = [];
  if (hasToolSearch) {
    capabilities.push(
      '- Discover what is already usable (`tool_search` for native `device__*`, MCP, and connected app tools) and act directly on authorized reads without redundant confirmation.',
    );
  }
  if (hasRequireConnection || hasToolSearch) {
    capabilities.push(
      '- Bridge missing integrations instead of refusing: when a connector or installable integration fits the user\'s goal, guide setup proactively through `xopc_require_connection` so the user can connect or switch sources in one click and let the host resume automatically.',
    );
  }
  if (hasMcpSetup) {
    capabilities.push(
      '- Expand to external services via `mcp_setup` when the user wants to work with a service that lacks a ready managed connector.',
    );
  }
  if (hasBrowser) {
    capabilities.push(
      '- Use `browser_use` proactively when a web route is the fastest, best, or remaining way to get the answer (or after a skipped connection): load `browser_use` if deferred and read directly without asking for pre-confirmation to open the browser. If sign-in, MFA, or CAPTCHA blocks progress, call `browser_use(action="request_user")` to hand over the tab and continue once resolved. Ask for a URL only when neither context nor open tabs identify where to look.',
    );
  }

  return [
    '## Proactive Problem Solving & Capability Judgment',
    'Take ownership of the user\'s real goal rather than stopping at missing setup. Do not default to "I can\'t do that" or "I don\'t have access" simply because a tool or integration is not yet connected—use your judgment to choose or combine the most reliable, lowest-friction authorized path to deliver the outcome:',
    ...capabilities,
    '- Exercise judgment and restraint: adapt if one route hits a dead end, and avoid forcing setup or browser calls for ordinary Q&A or advice that needs no external access. After solving a task through the browser, you may briefly note if a reusable connector or MCP could make similar requests smoother next time.',
    '- Respect hard boundaries: honor policy denials and user skips/declines (never repeat a skipped connection for the same objective), keep credentials out of chat, and keep impactful writes, sends, or purchases subject to explicit confirmation. Report a limitation—paired with the simplest practical fallback—only after exhausting authorized paths.',
  ].join('\n');
}
