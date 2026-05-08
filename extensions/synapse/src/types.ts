/**
 * Synapse 共享类型定义
 * 被 index.ts（后端 Tool）和 panel-entry.ts（前端 UI）共同引用
 */

/** 卡片列 */
export type Column = 0 | 1 | 2 | 3; // 0=待办 1=进行中 2=审查中 3=已完成

export const COLUMN_LABELS: Record<number, string> = {
  0: '待办',
  1: '进行中',
  2: '审查中',
  3: '已完成',
};

/** 优先级 */
export type Priority = 'p0' | 'p1' | 'p2';

/** Agent 指示器（卡片上的小圆点头像） */
export interface AgentIndicator {
  icon: string;
  name: string;
  status: 'active' | 'idle' | 'done';
  progress: number;
}

/** 看板卡片 */
export interface Card {
  i: number;
  c: Column;
  t: string;
  l: Priority;
  d: string;
  ag: AgentIndicator[];
  tg: string[];
  al?: string;
  pr: number;
}

/** 决策项 */
export interface Decision {
  i: number;
  l: 'p0' | 'p1';
  t: string;
  x: string;
  b: DecisionOption[];
}

export interface DecisionOption {
  l: string;
  c: string;
  m: string;
}

/** 活动条目 */
export interface Activity {
  t: string;
  x: string;
  nb?: boolean;
}

/** Agent 定义（Dock 展示） */
export interface AgentDef {
  id: string;
  icon: string;
  label: string;
  name: string;
  role: string;
  trust: number;
  status: 'active' | 'idle' | 'alert';
  narrative: string;
  progress: number | null;
}

/** 完整看板状态 */
export interface BoardState {
  cards: Card[];
  decisions: Decision[];
  activity: Activity[];
  agents: AgentDef[];
  tick: number;
}

/** Tool 参数类型 */

export interface CreateCardParams {
  title: string;
  description: string;
  priority: Priority;
  column?: Column;
  tags?: string[];
  agents?: { icon: string; name: string }[];
}

export interface MoveCardParams {
  cardId: number;
  toColumn: Column;
}

export interface UpdateProgressParams {
  cardId: number;
  progress: number;
}

export interface AddDecisionParams {
  level: 'p0' | 'p1';
  title: string;
  context: string;
  options: { label: string; recommended: boolean; confirmMessage: string }[];
}

export interface ResolveDecisionParams {
  decisionId: number;
  optionIndex: number;
}
