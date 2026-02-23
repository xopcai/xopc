/**
 * Agent Types
 * 
 * Core type definitions for agent configuration
 */

import type { AgentDefaults } from './types.agent-defaults.js';

// ============================================
// Agent Configuration
// ============================================

export interface AgentConfig {
  defaults?: AgentDefaults;
  list?: Record<string, AgentDefaults>;
}

// ============================================
// Agent Runtime State
// ============================================

export interface AgentRuntimeState {
  sessionKey: string;
  currentModel?: string;
  messageCount: number;
  lastActivity: number;
}
