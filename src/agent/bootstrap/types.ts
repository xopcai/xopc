import type { AgentProfileMarkdownFilename } from '../context/workspace.js';

export type BootstrapFileName = AgentProfileMarkdownFilename | 'PROFILE.md';

export type WorkspaceBootstrapFile = {
  name: BootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
};

export type EmbeddedContextFile = {
  path: string;
  content: string;
};
