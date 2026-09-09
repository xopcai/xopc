import type {
  KnowledgeItem,
  KnowledgeSource,
  KnowledgeVisibilityContext,
} from '../../knowledge-memory/index.js';
import type { UserAssertion } from '../../user-model/domain.js';

export type RuleEnforcementLevel = 'prompt' | 'planner' | 'tool_gate';

export interface ExecutionRule {
  id: string;
  statement: string;
  priority: number;
  enforcementLevel: RuleEnforcementLevel;
  conditions: Record<string, unknown>;
}

export interface RankedExecutionAssertion {
  assertion: UserAssertion;
  usage: 'confirmed' | 'working_assumption';
  score: number;
  reasons: string[];
}

export interface ExecutionGoal {
  id: string;
  title: string;
  desiredOutcome: string;
  status: string;
  usage: 'confirmed' | 'working_assumption';
  declaredImportance?: number;
  targetAt?: number;
}

export interface ExecutionPriority {
  id: string;
  targetType: string;
  targetId: string;
  rank: 'primary' | 'secondary' | 'background';
  urgency: number;
  validTo: number;
}

export interface ExecutionContext {
  traceId: string;
  asOf: number;
  query: string;
  rules: ExecutionRule[];
  assertions: RankedExecutionAssertion[];
  goals: ExecutionGoal[];
  priorities: ExecutionPriority[];
  knowledge: KnowledgeItem[];
}

export interface ExecutionContextRequest extends KnowledgeVisibilityContext {
  query: string;
  asOf?: number;
  maxAssertions?: number;
  maxKnowledge?: number;
  includeUserModel?: boolean;
  includeKnowledge?: boolean;
  knowledgeSources?: readonly KnowledgeSource[];
}
