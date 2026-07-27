import type { CreateGoalDraft } from './goal-create-dialog';

export function emptyCreateDraft(): CreateGoalDraft {
  return {
    title: '',
    objective: '',
    description: '',
    attachments: [],
    checklist: [''],
    scopeBoundary: '',
    evidencePlan: [''],
    priority: 'normal',
    deadlineMode: 'none',
    deadline: '',
    maxTurns: '10',
    agentId: '',
    judgeModelRef: '',
  };
}

export function normalizeChecklist(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = item.trim();
    const normalizedText = text.toLowerCase();
    if (!text || seen.has(normalizedText)) continue;
    seen.add(normalizedText);
    result.push(text);
  }
  return result;
}
