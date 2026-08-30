import type { UnderstandingKind } from './user-context-api';

export const UNDERSTANDING_KIND_LABELS: Record<UnderstandingKind, { en: string; zh: string }> = {
  preference: { en: 'Preference', zh: '偏好' },
  boundary: { en: 'Boundary', zh: '边界' },
  relationship: { en: 'Relationship', zh: '关系' },
  routine: { en: 'Routine', zh: '习惯' },
  current_state: { en: 'Current state', zh: '当前状态' },
  long_term_goal: { en: 'Long-term goal', zh: '长期目标' },
  project_context: { en: 'Project context', zh: '项目背景' },
  task_lesson: { en: 'Task lesson', zh: '任务经验' },
  derived_insight: { en: 'Insight', zh: '洞察' },
};
