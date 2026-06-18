import { browserUseManual } from './browser.js';

export interface ToolManual {
  toolName: string;
  title: string;
  description: string;
  content: string;
}

export type ToolManualSummary = Omit<ToolManual, 'content'>;

const TOOL_MANUALS: Record<string, ToolManual> = {
  browser_use: {
    toolName: 'browser_use',
    title: 'Browser Tool Manual',
    description: 'Usage guide for browser navigation, inspection, interaction, screenshots, and pipelines.',
    content: browserUseManual,
  },
};

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function getToolManual(toolName: string): ToolManual | null {
  return TOOL_MANUALS[normalizeToolName(toolName)] ?? null;
}

export function hasToolManual(toolName: string): boolean {
  return getToolManual(toolName) !== null;
}

export function listToolManuals(): ToolManualSummary[] {
  return Object.values(TOOL_MANUALS)
    .map(({ toolName, title, description }) => ({ toolName, title, description }))
    .sort((a, b) => a.toolName.localeCompare(b.toolName));
}
