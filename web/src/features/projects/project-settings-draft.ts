import type { Project } from './api';

export function projectSettingsDraft(project: Project) {
  return {
    name: project.name,
    description: project.description ?? '',
    status: project.status,
    defaultAgentId: project.defaultAgentId ?? '',
    executionMode: project.executionMode,
    workspaceRoot: project.workspaceRoot ?? '',
    brief: project.brief ?? '',
    instructions: project.instructions ?? '',
  };
}

export type ProjectSettingsDraft = ReturnType<typeof projectSettingsDraft>;

export function mergeProjectSettingsDraft(draft: ProjectSettingsDraft, previous: Project, next: Project): ProjectSettingsDraft {
  const before = projectSettingsDraft(previous);
  const after = projectSettingsDraft(next);
  const untouched = (Object.keys(before) as Array<keyof ProjectSettingsDraft>)
    .filter(key => draft[key] === before[key]);
  return { ...draft, ...Object.fromEntries(untouched.map(key => [key, after[key]])) };
}
