import type { AgentProfileMarkdownFilename } from '../context/workspace.js';

export type BootstrapFileName = AgentProfileMarkdownFilename | 'BOOTSTRAP.md';

export interface WorkspaceBootstrapFile {
  name: BootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
}

export interface EmbeddedContextFile {
  path: string;
  content: string;
}
