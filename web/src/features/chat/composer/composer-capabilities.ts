export interface ComposerCapabilities {
  commands: boolean;
  skills: boolean;
  agentSwitch: boolean;
}

export const CHAT_COMPOSER_CAPABILITIES: Readonly<ComposerCapabilities> = {
  commands: true, skills: true, agentSwitch: true,
};

export const PERSONAL_COMPOSER_CAPABILITIES: Readonly<ComposerCapabilities> = {
  commands: false, skills: false, agentSwitch: false,
};
