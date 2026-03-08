/**
 * xopcbot Plugin System - Core Types
 * 
 * Main type definitions file (backward compatible).
 * Types are organized in submodules for better maintainability.
 */



// ============================================================================
// Re-export from submodules for backward compatibility
// ============================================================================

export * from './types/core.js';
export * from './types/tools.js';
export * from './types/hooks.js';
export * from './types/events.js';
export * from './types/channels.js';
export * from './types/phase4.js';
export * from './types/loader.js';

// ============================================================================
// Additional types that need to reference Config
// ============================================================================

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; data?: string }>;
  name?: string;
  toolCallId?: string;
}
