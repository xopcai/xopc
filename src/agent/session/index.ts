/**
 * Session Layer - Exports all session-related modules
 */

export {
  SessionContextManager,
  type SessionContext,
} from './session-context.js';

export {
  SessionLifecycleManager,
  type SessionLifecycleEvents,
  type SessionStats,
} from './session-lifecycle.js';

export {
  SessionStateBag,
  type SessionStateBagOptions,
  type WebchatSsePublisher,
  type PersistentGoalStreamOutcome,
} from './session-state-bag.js';

export {
  SessionConfigService,
  type SessionConfigServiceOptions,
  type PatchSessionAgentConfigInput,
  type PatchSessionAgentConfigResult,
} from './session-config-service.js';

export {
  SessionHydrator,
  type SessionHydratorOptions,
} from './session-hydrator.js';

export {
  SessionInspector,
  type SessionInspectorOptions,
  type SessionContextUsage,
  type SessionAgentConfigView,
} from './session-inspector.js';
