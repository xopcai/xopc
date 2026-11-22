import type { SetupSceneId } from './types.js';

export interface SetupRecoveryHint {
  kind: 'setup_required';
  scene: SetupSceneId;
  reason: string;
  capability?: string;
  settingsSection: string;
  nextAction: string;
}

const SCENE_TO_SETTINGS_SECTION: Record<SetupSceneId, string> = {
  models: 'capabilities/models',
  web_search: 'capabilities/web-search',
  voice: 'capabilities/voice',
  channels: 'channels',
  computer: 'agent-computer',
  browser: 'agent-browser',
  phone: 'agent-phone',
  mcp: 'capabilities',
};

export function buildSetupRecoveryHint(input: {
  scene: SetupSceneId;
  reason: string;
  capability?: string;
  resumeObjective?: string;
}): SetupRecoveryHint {
  const args: Record<string, string> = {
    scene: input.scene,
    ...(input.capability ? { capability: input.capability } : {}),
    ...(input.resumeObjective ? { resumeObjective: input.resumeObjective.slice(0, 300) } : {}),
  };
  return {
    kind: 'setup_required',
    scene: input.scene,
    reason: input.reason,
    ...(input.capability ? { capability: input.capability } : {}),
    settingsSection: SCENE_TO_SETTINGS_SECTION[input.scene],
    nextAction: `Start guided self-configuration via xopc_use({ mode: "setup", command: "start", args: ${JSON.stringify(args)} }) so the user can complete setup and resume automatically.`,
  };
}
