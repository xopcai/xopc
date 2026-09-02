import { ModelIntentSchema, type ModelIntent } from '../agent-config/index.js';
import { resolveEffectiveAgentConfigForAgent } from './agent-profile.js';
import { parseModelRef, type Config } from './schema.js';

export interface ResolvedModelIntent {
  intent: ModelIntent;
  model: string;
  fallbacks: string[];
}

export function resolveEffectiveModelIntents(
  config: Config,
  agentId: string,
): Map<ModelIntent, ResolvedModelIntent> {
  const intents = new Map<ModelIntent, ResolvedModelIntent>();
  const effective = resolveEffectiveAgentConfigForAgent(config, agentId).config;
  for (const [intent, route] of Object.entries(effective.models.intents)) {
    const parsedIntent = ModelIntentSchema.safeParse(intent);
    if (parsedIntent.success && route) {
      intents.set(parsedIntent.data, {
        intent: parsedIntent.data,
        model: route.primary,
        fallbacks: [...route.fallbacks],
      });
    }
  }
  return intents;
}

export function resolveModelIntentRef(
  config: Config,
  agentId: string,
  intent: ModelIntent,
): string | undefined {
  return resolveEffectiveModelIntents(config, agentId).get(intent)?.model;
}

export function resolveModelSelector(config: Config, agentId: string, selector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) throw new Error('model selector must not be empty');
  if (trimmed.includes('/')) {
    if (!parseModelRef(trimmed)) throw new Error(`model ref must be provider/model format (got '${trimmed}')`);
    return trimmed;
  }

  const intentText = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
  const intent = ModelIntentSchema.safeParse(intentText);
  if (!intent.success) {
    throw new Error(`Unknown model intent '${intentText}'`);
  }
  const resolved = resolveModelIntentRef(config, agentId, intent.data);
  if (resolved) return resolved;
  return resolveEffectiveAgentConfigForAgent(config, agentId).config.models.chat.primary;
}
