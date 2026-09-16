import type { Config } from '../config/schema.js';
import { resolveModel } from '../providers/index.js';
import { isComputerModel } from './model-policy.js';

/** Validate only changed bindings, so a withdrawn model cannot block unrelated settings. */
export function validateComputerModelChanges(next: Config, previous: Config): void {
  const bindings = [
    { next: next.agents.defaults.models.computerUse, previous: previous.agents.defaults.models.computerUse },
    ...next.agents.list.map(agent => ({ next: agent.models?.computerUse,
      previous: previous.agents.list.find(item => item.id === agent.id)?.models?.computerUse })),
  ];
  for (const binding of bindings) {
    if (!binding.next) continue;
    if (binding.next.fallbacks.length) throw new Error('Computer Use does not support fallback models');
    if (binding.next.primary === binding.previous?.primary) continue;
    let compatible = false;
    try { compatible = isComputerModel(resolveModel(binding.next.primary)); } catch { /* Report a stable validation error. */ }
    if (!compatible) throw new Error('Select an available model with a supported Computer Use profile');
  }
}
