/**
 * Thinking Types
 *
 * Defines types for thinking ability management across the application.
 * Based on OpenClaw's thinking system.
 */

// ============================================
// Thinking Levels
// ============================================

/**
 * Thinking level for models that support extended thinking.
 * - off: No thinking
 * - minimal: Minimal thinking effort
 * - low: Low thinking effort
 * - medium: Medium thinking effort
 * - high: High thinking effort
 * - xhigh: Extra high thinking (for supported models only)
 * - adaptive: Automatically adjust based on task complexity
 */
export type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';

/**
 * Reasoning visibility level.
 * Controls whether the model's reasoning/thinking is shown to the user.
 * - off: Hide reasoning
 * - on: Show reasoning after completion
 * - stream: Stream reasoning in real-time
 */
export type ReasoningLevel = 'off' | 'on' | 'stream';

/**
 * Verbose level for agent output.
 * - off: Minimal output
 * - on: Normal verbose output
 * - full: Full verbose output with all details
 */
export type VerboseLevel = 'off' | 'on' | 'full';

/**
 * Elevated mode for bash execution permissions.
 * - off: No elevated permissions
 * - ask: Ask for confirmation before elevated commands
 * - full: Allow all elevated commands without confirmation
 */
export type ElevatedMode = 'off' | 'ask' | 'full';

// ============================================
// Session-Level Configuration
// ============================================

/**
 * Session-level configuration for agent behavior.
 * These settings can be overridden per-session.
 */
export interface SessionAgentConfig {
  /** Thinking level for this session */
  thinkingLevel?: ThinkLevel;
  /** Reasoning visibility for this session */
  reasoningLevel?: ReasoningLevel;
  /** Verbose level for this session */
  verboseLevel?: VerboseLevel;
  /** Elevated mode for this session */
  elevatedMode?: ElevatedMode;
  /** Model override for this session */
  modelOverride?: string;
  /** Provider override for this session */
  providerOverride?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Normalize a raw string to ThinkLevel.
 * Handles various aliases and formats.
 */
export function normalizeThinkLevel(raw?: string | null): ThinkLevel | undefined {
  if (!raw) {
    return undefined;
  }
  const key = raw.trim().toLowerCase();
  const collapsed = key.replace(/[\s_-]+/g, '');

  if (collapsed === 'adaptive' || collapsed === 'auto') {
    return 'adaptive';
  }
  if (collapsed === 'xhigh' || collapsed === 'extrahigh') {
    return 'xhigh';
  }
  if (['off', 'disable', 'disabled'].includes(key)) {
    return 'off';
  }
  if (['on', 'enable', 'enabled'].includes(key)) {
    return 'low';
  }
  if (['min', 'minimal'].includes(key)) {
    return 'minimal';
  }
  if (['low', 'thinkhard', 'think-hard', 'think_hard'].includes(key)) {
    return 'low';
  }
  if (['mid', 'med', 'medium', 'thinkharder', 'think-harder', 'harder'].includes(key)) {
    return 'medium';
  }
  if (['high', 'ultra', 'ultrathink', 'think-hard', 'thinkhardest', 'highest', 'max'].includes(key)) {
    return 'high';
  }
  if (['think'].includes(key)) {
    return 'minimal';
  }
  return undefined;
}

/**
 * Normalize a raw string to ReasoningLevel.
 */
export function normalizeReasoningLevel(raw?: string | null): ReasoningLevel | undefined {
  if (!raw) {
    return undefined;
  }
  const key = raw.toLowerCase();
  if (['off', 'false', 'no', '0', 'hide', 'hidden', 'disable', 'disabled'].includes(key)) {
    return 'off';
  }
  if (['on', 'true', 'yes', '1', 'show', 'visible', 'enable', 'enabled'].includes(key)) {
    return 'on';
  }
  if (['stream', 'streaming', 'draft', 'live'].includes(key)) {
    return 'stream';
  }
  return undefined;
}

/**
 * Normalize a raw string to VerboseLevel.
 */
export function normalizeVerboseLevel(raw?: string | null): VerboseLevel | undefined {
  if (!raw) {
    return undefined;
  }
  const key = raw.toLowerCase();
  if (['off', 'false', 'no', '0'].includes(key)) {
    return 'off';
  }
  if (['full', 'all', 'everything'].includes(key)) {
    return 'full';
  }
  if (['on', 'true', 'yes', '1', 'enable', 'enabled'].includes(key)) {
    return 'on';
  }
  return undefined;
}

/**
 * Normalize a raw string to ElevatedMode.
 */
export function normalizeElevatedMode(raw?: string | null): ElevatedMode | undefined {
  if (!raw) {
    return undefined;
  }
  const key = raw.toLowerCase();
  if (['off', 'false', 'no', '0'].includes(key)) {
    return 'off';
  }
  if (['full', 'auto', 'auto-approve', 'autoapprove'].includes(key)) {
    return 'full';
  }
  if (['ask', 'prompt', 'approval', 'approve'].includes(key)) {
    return 'ask';
  }
  return undefined;
}

/**
 * Get available thinking levels for a provider/model.
 * Returns ['off', 'on'] for binary providers like z.ai.
 */
export function listThinkingLevels(provider?: string | null, model?: string | null): (ThinkLevel | 'on')[] {
  // Binary thinking providers (like z.ai)
  const normalizedProvider = provider?.trim().toLowerCase();
  if (normalizedProvider === 'z.ai' || normalizedProvider === 'zai') {
    return ['off', 'on'];
  }

  const levels: (ThinkLevel | 'on')[] = ['off', 'minimal', 'low', 'medium', 'high'];

  // xhigh is only supported for specific models
  const normalizedModel = model?.trim().toLowerCase();
  if (normalizedModel && ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.2'].some((m) => normalizedModel.includes(m))) {
    levels.push('xhigh');
  }

  levels.push('adaptive');
  return levels;
}

/**
 * Format thinking levels as a comma-separated string for display.
 */
export function formatThinkingLevels(provider?: string | null, model?: string | null): string {
  return listThinkingLevels(provider, model).join(', ');
}

/**
 * Convert ThinkLevel to a numeric value for comparison.
 * Higher value = more thinking.
 */
export function thinkLevelToNumber(level: ThinkLevel): number {
  const map: Record<ThinkLevel, number> = {
    off: 0,
    minimal: 1,
    low: 2,
    medium: 3,
    high: 4,
    xhigh: 5,
    adaptive: 3, // adaptive defaults to medium
  };
  return map[level];
}
