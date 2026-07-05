export const DEFAULT_MODEL_ROLE = 'deep';
export const DEFAULT_MODEL_REF = 'deepseek/deepseek-v4-flash';

export const DEFAULT_AGENT_MODELS = {
  defaultRole: DEFAULT_MODEL_ROLE,
  roles: {
    [DEFAULT_MODEL_ROLE]: {
      model: DEFAULT_MODEL_REF,
      description: 'Default model for general agent work.',
    },
  },
} as const;
