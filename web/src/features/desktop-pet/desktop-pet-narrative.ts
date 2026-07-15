import { getFriendlyToolTitle, type FriendlyToolTitleLabels } from '@/features/chat/messages/tool-friendly-title';
import type { DesktopPetAction, DesktopPetActivityPhase } from '@/types/electron';

export type DesktopPetTipPriority = 'low' | 'normal' | 'high';

export type DesktopPetNarrativeLabels = FriendlyToolTitleLabels & {
  tipRunStart: string;
  tipTool: string;
  tipProgress: string;
  tipValidate: string;
  tipWaiting: string;
  tipAssistantDelta: string;
  tipCommandDelta: string;
  tipAssistantDone: string;
  tipComplete: string;
  tipError: string;
  targetSuffix: string;
  progressSuffix: string;
};

export type DesktopPetNarrative = {
  action: string;
  animation: DesktopPetAction;
  priority: DesktopPetTipPriority;
};

function fill(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined || value === '' ? '' : String(value);
  }).replace(/\s+/g, ' ').trim();
}

function progressText(labels: DesktopPetNarrativeLabels, completed?: number, total?: number): string {
  if (typeof completed !== 'number' || typeof total !== 'number') return '';
  return labels.progressSuffix
    .replace(/\{\{completed\}\}/g, String(completed))
    .replace(/\{\{total\}\}/g, String(total));
}

export function desktopPetActionForPhase(
  phase: DesktopPetActivityPhase,
  toolName?: string,
): DesktopPetAction {
  const normalizedToolName = toolName?.trim().toLowerCase().replace(/[.:/\\-]+/g, '_') ?? '';
  if (normalizedToolName.includes('exec_command') || normalizedToolName.includes('run_command') || normalizedToolName.includes('shell')) {
    return 'terminal';
  }
  if (phase === 'researching') return 'search';
  if (phase === 'reading' || phase === 'editing') return 'file';
  if (phase === 'browsing') return 'browser';
  if (phase === 'planning' || phase === 'compacting' || phase === 'preparing') return 'toolbox';
  if (phase === 'running') return 'typing';
  return 'typing';
}

export function toolNarrative(
  labels: DesktopPetNarrativeLabels,
  toolName: string,
  phase: DesktopPetActivityPhase,
  detail?: string,
): DesktopPetNarrative {
  const action = getFriendlyToolTitle(toolName, labels);
  return {
    action: fill(labels.tipTool, { action, detail: detail ? fill(labels.targetSuffix, { detail }) : '' }),
    animation: desktopPetActionForPhase(phase, toolName),
    priority: 'normal',
  };
}

export function progressNarrative(
  labels: DesktopPetNarrativeLabels,
  phase: DesktopPetActivityPhase,
  completed?: number,
  total?: number,
): DesktopPetNarrative {
  return {
    action: fill(phase === 'running' ? labels.tipValidate : labels.tipProgress, {
      progress: progressText(labels, completed, total),
    }),
    animation: desktopPetActionForPhase(phase),
    priority: 'normal',
  };
}
