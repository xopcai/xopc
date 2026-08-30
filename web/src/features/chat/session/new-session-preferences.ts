import {
  createDefaultNewSessionPreferences,
  parseNewSessionPreferences,
  withAgentModelPreference,
  withLastChatScope,
  withSelectedAgent,
  type AgentModelPreference,
  type NewSessionPreferences,
} from '@xopcai/gateway-contract';

const STORAGE_KEY = 'xopc.webchat.newSessionPreferences';

export function readNewSessionPreferences(): NewSessionPreferences {
  if (typeof globalThis.localStorage === 'undefined') {
    return createDefaultNewSessionPreferences();
  }
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);
    return parseNewSessionPreferences(stored ? JSON.parse(stored) : null);
  } catch {
    return createDefaultNewSessionPreferences();
  }
}

function writePreferences(preferences: NewSessionPreferences): NewSessionPreferences {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* Browser storage is an optional convenience. */
  }
  return preferences;
}

export function rememberSelectedAgent(agentId: string | null | undefined): NewSessionPreferences {
  return writePreferences(withSelectedAgent(readNewSessionPreferences(), agentId));
}

export function rememberAgentModel(
  agentId: string,
  preference: AgentModelPreference | null,
): NewSessionPreferences {
  return writePreferences(
    withAgentModelPreference(readNewSessionPreferences(), agentId, preference),
  );
}

export function rememberLastChatScope(projectId: string | null | undefined): NewSessionPreferences {
  return writePreferences(withLastChatScope(readNewSessionPreferences(), projectId));
}
