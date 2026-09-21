import { resolveDefaultAgentId } from '../agent/agent-scope.js';
import { resolveModelSelector } from '../config/agent-model-intents.js';
import type { Config } from '../config/schema.js';

/** Scene reasoning follows the existing agent model policy and falls back to chat. */
export function resolveSceneModelRef(config: Config): string {
  return resolveModelSelector(config, resolveDefaultAgentId(config), '@reasoning');
}
