import { z } from 'zod';

export const WorkCandidateSchema = z.object({
  kind: z.enum(['work_thread', 'project_fact', 'workspace_fact', 'decision', 'task_lesson', 'commitment', 'open_question', 'episode', 'note']),
  topicKey: z.string().min(1).max(160), predicate: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
  statement: z.string().min(4).max(1200),
  scope: z.enum(['project', 'workspace', 'session']),
  confidence: z.number().min(0).max(1), importance: z.number().min(0).max(1),
  evidence: z.array(z.object({ ref: z.string(), quote: z.string().min(1) }).strict()).min(1).max(8),
}).strict();
export type WorkCandidate = z.infer<typeof WorkCandidateSchema>;
