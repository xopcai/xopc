import {
  createDefaultNewSessionPreferences,
  modelPreferenceForAgent,
  withAgentModelPreference,
  withLastChatScope,
  withSelectedAgent,
  type AgentModelPreference,
  type NewSessionPreferences,
  type SessionInitialAgentConfig,
} from '@xopcai/gateway-contract';

import type { TuiSettings } from './tui-settings.js';

export function tuiGatewayPreferenceKey(url?: string): string {
  return url?.trim() || 'local';
}

export function getTuiNewSessionPreferences(
  settings: TuiSettings,
  gatewayKey: string,
): NewSessionPreferences {
  return settings.newSessionPreferencesByGateway[gatewayKey]
    ?? createDefaultNewSessionPreferences();
}

function withPreferences(
  settings: TuiSettings,
  gatewayKey: string,
  preferences: NewSessionPreferences,
): TuiSettings {
  return {
    ...settings,
    newSessionPreferencesByGateway: {
      ...settings.newSessionPreferencesByGateway,
      [gatewayKey]: preferences,
    },
  };
}

export function rememberTuiSessionContext(
  settings: TuiSettings,
  gatewayKey: string,
  context: { agentId: string; projectId?: string | null },
): TuiSettings {
  const current = getTuiNewSessionPreferences(settings, gatewayKey);
  return withPreferences(
    settings,
    gatewayKey,
    withLastChatScope(
      withSelectedAgent(current, context.agentId),
      context.projectId,
    ),
  );
}

export function rememberTuiAgentModel(
  settings: TuiSettings,
  gatewayKey: string,
  agentId: string,
  preference: AgentModelPreference,
): TuiSettings {
  return withPreferences(
    settings,
    gatewayKey,
    withAgentModelPreference(
      getTuiNewSessionPreferences(settings, gatewayKey),
      agentId,
      preference,
    ),
  );
}

export function tuiInitialAgentConfig(
  settings: TuiSettings,
  gatewayKey: string,
  agentId: string,
): SessionInitialAgentConfig | undefined {
  const preference = modelPreferenceForAgent(
    getTuiNewSessionPreferences(settings, gatewayKey),
    agentId,
  );
  return preference
    ? {
        model: preference.modelRef,
        ...(preference.thinkingLevel ? { thinkingLevel: preference.thinkingLevel } : {}),
      }
    : undefined;
}
