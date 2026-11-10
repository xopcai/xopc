import { z } from 'zod';

const LessonQuoteSchema = z.object({ ref: z.string().min(1), quote: z.string().min(1).max(1200) }).strict();

export const WorkCandidateSchema = z.object({
  kind: z.enum(['work_thread', 'project_fact', 'workspace_fact', 'decision', 'task_lesson', 'commitment', 'open_question', 'episode', 'note']),
  topicKey: z.string().min(1).max(160), predicate: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
  statement: z.string().min(4).max(1200),
  scope: z.enum(['project', 'workspace', 'session']),
  confidence: z.number().min(0).max(1), importance: z.number().min(0).max(1),
  evidence: z.array(z.object({ ref: z.string(), quote: z.string().min(1) }).strict()).min(1).max(8),
  lesson: z.object({ condition: LessonQuoteSchema, action: LessonQuoteSchema, verification: LessonQuoteSchema }).strict().optional(),
}).strict().superRefine((candidate, context) => {
  if (candidate.kind === 'task_lesson' && !candidate.lesson) {
    context.addIssue({ code: 'custom', path: ['lesson'], message: 'task_lesson requires condition, action and tool verification quotes; use episode or note for unverified events.' });
  }
});
export type WorkCandidate = z.infer<typeof WorkCandidateSchema>;
