export {
  AGENT_CAPABILITY_DEFINITIONS,
  type AgentCapabilityActivationMode,
  type AgentCapabilityActivationSource,
  type AgentCapabilityCatalogEntry,
  type AgentCapabilityCategory,
  type AgentCapabilityDefinition,
  type AgentCapabilityPermissions,
  type AgentCapabilitySessionState,
  type AgentCapabilitySessionStatus,
  type AgentCapabilityTtl,
} from './definitions.js';
export {
  createAgentCapabilitySessionState,
  getAgentCapability,
  getAgentCapabilityToolNames,
  listAgentCapabilities,
  resolveAgentCapabilityCatalog,
} from './registry.js';
