import { TaskCollaborationRepository } from './task-collaboration-repository.js';

export function taskInstructionSequence(taskId: string): number {
  return new TaskCollaborationRepository().coordination(taskId)
    .filter(entry => ['main_agent', 'user'].includes(entry.authorKind) && ['answer', 'instruction'].includes(entry.kind)).at(-1)?.sequence ?? 0;
}
