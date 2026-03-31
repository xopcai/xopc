/**
 * Agent Types
 *
 * Core type definitions for agent configuration
 */

// ============================================
// Model Selection Types
// ============================================

export type ModelRef = string;

export interface ModelEntry {
  alias?: string;
  params?: Record<string, unknown>;
}

export type ModelList = Record<string, ModelEntry | undefined>;

// ============================================
// Context Pruning Types
// ============================================

export type ContextPruningMode = 'off' | 'eager' | 'lazy' | 'cache-ttl';

export interface ContextPruningConfig {
  mode?: ContextPruningMode;
  ttl?: string;
  eagerMaxTokens?: number;
  eagerThreshold?: number;
  eagerKeepAtLeast?: number;
  eagerKeepAtMost?: number;
}

// ============================================
// Heartbeat Types
// ============================================

export interface HeartbeatConfig {
  every?: string;
  enabled?: boolean;
  target?: string;
  on?: string[];
}

// ============================================
// Compaction Types
// ============================================

export type CompactionMode = 'off' | 'eager' | 'lazy' | 'safeguard';

export interface CompactionConfig {
  mode?: CompactionMode;
  eagerThreshold?: number;
  eagerKeepAtLeast?: number;
  eagerKeepAtMost?: number;
}

// ============================================
// Agent Defaults
// ============================================

export interface AgentDefaults {
  model?: ModelRef | { primary?: ModelRef; fallbacks?: ModelRef[] };
  models?: ModelList;
  maxConcurrent?: number;
  contextPruning?: ContextPruningConfig;
  heartbeat?: HeartbeatConfig;
  compaction?: CompactionConfig;
  temperature?: number;
  maxTokens?: number;
}

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
