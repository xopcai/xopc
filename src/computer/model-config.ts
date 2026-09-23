import type { AgentModelsDefaults } from '../agent-config/index.js';
import { resolveModel } from '../providers/index.js';
import { isComputerModel } from './model-policy.js';

/** Validate only a changed route, so a withdrawn model cannot block unrelated settings. */
export function validateComputerModelChange(
  next: AgentModelsDefaults['computerUse'] | null | undefined,
  previous: AgentModelsDefaults['computerUse'] | null | undefined,
): void {
  if (!next || next.primary === previous?.primary) return;
  if (next.fallbacks.length) throw new Error('Computer Use does not support fallback models');
  let compatible = false;
  try { compatible = isComputerModel(resolveModel(next.primary)); } catch { /* Stable validation error below. */ }
  if (!compatible) throw new Error('Select an available model with a supported Computer Use profile');
}
