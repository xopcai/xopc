import type { Focus, FocusMonitorKind } from './types.js';

export function buildFocusMonitorInstruction(focus: Focus, kind: FocusMonitorKind): string {
  const intent = kind === 'progress'
    ? 'Look for meaningful progress, blockers, and the most useful next step.'
    : 'Search for external changes published since the previous check. Prefer primary sources and include publication dates and canonical URLs.';
  return [
    'Monitor this user-confirmed focus in suggest-only mode.',
    `Focus: ${focus.title}`,
    `Context: ${focus.summary}`,
    intent,
    'Inspect only evidence that changed since the previous check.',
    'Do not modify files, send messages, publish content, or claim progress without evidence.',
    'Return JSON only, with no markdown.',
    'If nothing materially changed: {"meaningful":false}.',
    'Otherwise return {"meaningful":true,"title":"short title","summary":"what changed","whyItMatters":"concrete impact","nextAction":"one next action","evidence":[{"label":"specific evidence","source":"file, event, or canonical URL","publishedAt":"ISO date for external changes"}]}.',
    'A meaningful result requires specific evidence. Never invent evidence.',
  ].join('\n');
}
