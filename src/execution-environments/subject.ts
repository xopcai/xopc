import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { ExecutionEnvironmentStore } from './store.js';
import type { ExecutionEnvironment, ExecutionEnvironmentSubjectKind } from './types.js';

export function getExecutionEnvironmentForSubject(
  subjectKind: ExecutionEnvironmentSubjectKind,
  subjectId: string,
): ExecutionEnvironment | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const store = new ExecutionEnvironmentStore();
  const binding = store.resolveBinding(subjectKind, subjectId);
  return binding ? store.get(binding.environmentId) : undefined;
}

export function getExecutionEnvironmentForSession(sessionKey: string): ExecutionEnvironment | undefined {
  return getExecutionEnvironmentForSubject('session', sessionKey);
}
