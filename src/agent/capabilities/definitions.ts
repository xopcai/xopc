export type AgentCapabilityCategory = 'authoring' | 'research' | 'analysis' | 'assets';

export type AgentCapabilityActivationMode = 'explicit' | 'ui-entry' | 'workflow-scoped';

export type AgentCapabilityTtl = 'turn' | 'session' | 'until-complete';

export type AgentCapabilityActivationSource = 'skill' | 'ui' | 'workflow';

export type AgentCapabilitySessionStatus = 'collecting' | 'running' | 'complete';

export type AgentCapabilityPermissions = {
  writesFiles?: boolean;
  runsCode?: boolean;
  usesBrowser?: boolean;
  usesNetwork?: boolean;
  requiresConfirm?: boolean;
};

export type AgentCapabilityDefinition = {
  id: string;
  label: string;
  description: string;
  category: AgentCapabilityCategory;
  tools: readonly string[];
  requiredSkills?: readonly string[];
  promptHint?: string;
  activation: {
    mode: AgentCapabilityActivationMode;
    ttl: AgentCapabilityTtl;
  };
  permissions: AgentCapabilityPermissions;
};

export type AgentCapabilitySessionState = {
  id: string;
  source: AgentCapabilityActivationSource;
  activatedAt: number;
  ttl: AgentCapabilityTtl;
  status: AgentCapabilitySessionStatus;
};

export type AgentCapabilityCatalogEntry = AgentCapabilityDefinition & {
  availableTools: string[];
  unavailableTools: string[];
};

export const AGENT_CAPABILITY_DEFINITIONS = [
  {
    id: 'desktop-pet-authoring',
    label: 'Desktop pet authoring',
    description: 'Create, repair, and update local animated desktop pet packages.',
    category: 'authoring',
    tools: ['create_desktop_pet'],
    requiredSkills: ['hatch-pet'],
    promptHint:
      'Use clarify when the pet concept is vague. Create or update the pet only after appearance, personality, and animation goals are clear.',
    activation: { mode: 'explicit', ttl: 'until-complete' },
    permissions: { writesFiles: true },
  },
  {
    id: 'automation-authoring',
    label: 'Automation authoring',
    description: 'Create and update reminders, monitors, recurring checks, and scheduled follow-ups.',
    category: 'authoring',
    tools: ['automation'],
    activation: { mode: 'explicit', ttl: 'until-complete' },
    permissions: { writesFiles: true, requiresConfirm: true },
  },
  {
    id: 'workflow-authoring',
    label: 'Workflow authoring',
    description: 'Design, validate, and run xopc workflows.',
    category: 'authoring',
    tools: ['workflow'],
    activation: { mode: 'explicit', ttl: 'until-complete' },
    permissions: { writesFiles: true, runsCode: true, requiresConfirm: true },
  },
  {
    id: 'extension-authoring',
    label: 'Plugin and extension authoring',
    description: 'Scaffold, inspect, and package xopc plugins or extensions.',
    category: 'authoring',
    tools: ['read_file', 'write_file', 'apply_patch', 'list_dir', 'grep', 'find', 'exec_command'],
    activation: { mode: 'explicit', ttl: 'until-complete' },
    permissions: { writesFiles: true, runsCode: true, requiresConfirm: true },
  },
  {
    id: 'skill-authoring',
    label: 'Skill authoring',
    description: 'Create, edit, inspect, and maintain xopc skills.',
    category: 'authoring',
    tools: ['skills_list', 'skill_view', 'skill_manage'],
    activation: { mode: 'explicit', ttl: 'until-complete' },
    permissions: { writesFiles: true, requiresConfirm: true },
  },
  {
    id: 'skill-installation',
    label: 'Skill installation',
    description: 'Find, install, and update xopc skills from explicit sources.',
    category: 'authoring',
    tools: ['skills_list', 'skill_view', 'skill_install'],
    activation: { mode: 'explicit', ttl: 'turn' },
    permissions: { writesFiles: true, usesNetwork: true },
  },
  {
    id: 'visual-asset-authoring',
    label: 'Visual asset authoring',
    description: 'Generate and inspect images, icons, sprites, and other visual assets.',
    category: 'assets',
    tools: ['image', 'image_generate', 'read_media', 'send_media'],
    activation: { mode: 'explicit', ttl: 'session' },
    permissions: { writesFiles: true, usesNetwork: true },
  },
  {
    id: 'browser-research',
    label: 'Browser research',
    description: 'Perform deeper web research with search, extraction, fetch, and browser interaction.',
    category: 'research',
    tools: ['web_search', 'web_fetch', 'web_extract', 'browser_use'],
    activation: { mode: 'explicit', ttl: 'turn' },
    permissions: { usesBrowser: true, usesNetwork: true },
  },
  {
    id: 'data-analysis',
    label: 'Data analysis',
    description: 'Analyze local structured data and produce derived tables, summaries, or artifacts.',
    category: 'analysis',
    tools: ['read_file', 'write_file', 'list_dir', 'grep', 'find'],
    activation: { mode: 'explicit', ttl: 'session' },
    permissions: { writesFiles: true, runsCode: true },
  },
] as const satisfies readonly AgentCapabilityDefinition[];
