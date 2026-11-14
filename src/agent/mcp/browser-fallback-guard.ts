import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import { stripRuntimeContextFromUserMessage } from '../../session/user-message-display.js';
import { findSessionInputByRunId } from '../../storage/sqlite/session-input-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-read-repository.js';
import { loadRecentUserTranscriptRows } from '../../storage/sqlite/transcript-repository.js';
import { getEmbeddedExecutionRunId } from '../embedded/execution-context.js';

import { getMcpDiscoveryOutcome } from './discovery.js';

function accountLookupService(text: string): string | undefined {
  const zh = /^(?:请|麻烦)?(?:帮我|替我|给我)?(?:查询|查(?:看|询)?|看看)(?:一下|下)?(?:我的)?\s*(?<service>[\p{L}\p{N}·.' -]{2,48}?)(?:账号|账户|会员|的|\s)*(?:积分|余额|订单(?:状态|记录)?|账单|个人资料)[。？?!！]?$/u;
  const en = /^(?:please )?(?:check|look up|find|show me) (?:my |the )?(?:points|balance|orders?|bills?|profile)(?: (?:on|in|with|at|for|from)) (?<service>[\p{L}\p{N}.' -]{2,48})[?.!]?$/iu;
  const service = (zh.exec(text) ?? en.exec(text))?.groups?.service.trim();
  if (service && !/^(?:我的?|会员|账户|账号|我在|本月|上周|最近|当前|the|account|my)$/iu.test(service)) return service;
}

const followUp = /^(?:我需要你|我想让你|那就|请)?(?:帮我|替我)?(?:继续)?(?:查询|查一下|查下|查|继续)[。！!]?$/u;

function originalAccountLookup(conversationId: string, current: string) {
  if (!followUp.test(current)) return current;
  return loadRecentUserTranscriptRows(conversationId, 2).flatMap(row => {
    if (!('role' in row) || row.role !== 'user') return [];
    const text = typeof row.content === 'string' ? row.content
      : row.content.filter(block => block.type === 'text').map(block => block.text).join(' ');
    return [stripRuntimeContextFromUserMessage(text).trim()];
  }).find(text => text !== current) ?? current;
}

/** Keep a named account lookup on its connection route before dispatching browser actions. */
export function createMcpBrowserFallbackGuard(conversationId: string): ExtensionFactory {
  return pi => {
    pi.on('tool_call', event => {
      const browserSetup = event.toolName === 'xopc_use' && event.input.mode === 'browser_setup';
      const browserAction = event.toolName === 'browser_use' && event.input.action !== 'close';
      const browserDevice = event.toolName.startsWith('device__web_page_');
      if (!browserSetup && !browserAction && !browserDevice) return;
      const runId = getEmbeddedExecutionRunId();
      if (!runId) return;
      const input = findSessionInputByRunId(conversationId, runId);
      if (!input || !(input.origin.type === 'endpoint'
        || input.origin.type === 'system' && input.origin.source === 'cli')) return;
      const purpose = originalAccountLookup(conversationId, input.content.trim());
      const serviceName = accountLookupService(purpose);
      if (!serviceName) return;
      const session = getSessionMetadata(conversationId);
      const discovery = session?.transcriptId && getMcpDiscoveryOutcome(conversationId, session.transcriptId, runId, serviceName);
      if (discovery === 'no_match') return;
      if (discovery === 'managed' || discovery === 'references') return {
        block: true,
        reason: 'The requested account service has a connection discovery result in this turn. Use its matching connector or review the documented MCP plan and let the host handle any authorization. Browser fallback has not been established.',
      };
      if (discovery === 'incomplete') return {
        block: true,
        reason: 'Browser fallback is paused because MCP discovery could not verify availability. Preserve the account scope and report the specific discovery blocker.',
      };
      return {
        block: true,
        reason: `Browser fallback for this account lookup requires MCP discovery first. Search for tools for the exact service if needed, then call mcp_setup with ${JSON.stringify({ command: 'discover', args: { serviceName, purpose } })} if no matching tool can do the task.`,
      };
    });
  };
}
