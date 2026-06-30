import type { Config } from '../../../../config/schema.js';

export function applyAgentsPatch(_config: Config, body: any): void {
  if (body.agents !== undefined) {
    throw new Error('agents config patching was removed; use manifest-specific agent APIs');
  }
}
