import type { Config } from '../../config/schema.js';
import type { ProjectService } from '../../projects/project-service.js';
import type { SessionDetail } from '../../session/types.js';
import type { SessionAgentConfigView } from '../../agent/session/session-inspector.js';
import type { SessionInputCoordinator } from './session-input-coordinator.js';

/** Narrow host contract shared by HTTP commands and Agent conversation launches. */
export interface SessionCommandHost {
  currentConfig: Config;
  projects: ProjectService;
  sessions: {
    getSession(id: string): Promise<SessionDetail | null>;
    getAgentConfig(id: string): Promise<SessionAgentConfigView>;
  };
  voiceRealtime?: { hasConversation(id: string): boolean };
  withSessionInputSubmission: SessionInputCoordinator['withSubmission'];
  prepareSessionCommandInput: SessionInputCoordinator['prepareInput'];
  dispatchAcceptedSessionInput: SessionInputCoordinator['dispatchAcceptedInput'];
  drainSessionInputs: SessionInputCoordinator['drain'];
  getSessionInputState: SessionInputCoordinator['snapshot'];
  sessionPreparations: { wake(id: string): void };
  emit(type: string, payload: unknown): void;
}
