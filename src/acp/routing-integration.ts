/**
 * ACP Routing Integration
 * 
 * Integrates ACP sessions with the new routing system.
 * Ensures ACP sessions use the unified session key format.
 */

import { parseSessionKey } from '../routing/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AcpRouting');

/**
 * Build ACP session key in unified format
 * 
 * Format: {agentId}:acp:{uuid}
 */
export function buildAcpSessionKey(params: {
  agentId: string;
  acpId: string;
}): string {
  const { agentId, acpId } = params;
  
  // ACP sessions use special format: {agentId}:acp:{uuid}
  return `${agentId}:acp:${acpId}`;
}

/**
 * Build subagent ACP session key
 * 
 * Format: subagent:{parentId}:acp:{uuid}
 */
export function buildSubagentAcpSessionKey(params: {
  parentAgentId: string;
  parentSessionId: string;
  acpId: string;
}): string {
  const { parentAgentId, parentSessionId, acpId } = params;
  
  return `subagent:${parentAgentId}:${parentSessionId}:acp:${acpId}`;
}

/**
 * Check if a session key is an ACP session
 */
export function isAcpSessionKey(sessionKey: string): boolean {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return false;
  
  return parsed.source === 'acp';
}

/**
 * Extract agent ID from ACP session key
 */
export function extractAgentIdFromAcpKey(sessionKey: string): string | null {
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  
  // Format: {agentId}:acp:{uuid}
  if (parts[1] === 'acp') {
    return parts[0];
  }
  
  // Format: subagent:{parentId}:{parentSessionId}:acp:{uuid}
  if (parts[0] === 'subagent' && parts.length >= 5 && parts[3] === 'acp') {
    return parts[1];
  }
  
  return null;
}

/**
 * Validate ACP session key format
 */
export function isValidAcpSessionKey(sessionKey: string): boolean {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return false;
  
  // ACP sessions should have source='acp'
  if (parsed.source !== 'acp') return false;
  
  // Should have valid agentId
  if (!parsed.agentId) return false;
  
  return true;
}

/**
 * Convert legacy ACP session key to new format
 * 
 * Legacy formats:
 * - acp:{uuid}
 * - ACP:{uuid}
 * 
 * New format:
 * - {agentId}:acp:{uuid}
 */
export function migrateLegacyAcpKey(
  legacyKey: string,
  defaultAgentId: string = 'main'
): string {
  const parts = legacyKey.split(':');
  
  // Already in new format
  if (parts.length >= 3 && parts[1] === 'acp') {
    return legacyKey;
  }
  
  // Legacy format: acp:{uuid}
  if (parts[0].toLowerCase() === 'acp' && parts[1]) {
    return `${defaultAgentId}:acp:${parts[1]}`;
  }
  
  // Unknown format, wrap as-is
  log.warn({ legacyKey }, 'Unknown ACP key format, wrapping as-is');
  return `${defaultAgentId}:acp:${legacyKey}`;
}
