import type { Config } from '../../config/schema.js';

/** Whether generic workspace and provider-backed memory is available. */
export function isMemorySubsystemEnabled(config: Config | undefined): boolean {
  if (!config) return true;
  return config.userContext.enabled && config.userContext.knowledgeMemory.enabled;
}
