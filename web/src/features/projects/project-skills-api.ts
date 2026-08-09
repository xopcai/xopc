import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ProjectSkill = {
  id: string;
  name: string;
  description: string;
  category?: string;
  disableModelInvocation: boolean;
  bodyMarkdown?: string;
};

export type ProjectSkillsResponse = {
  ok: true;
  workspaceRoot: string;
  skillsRoot: string;
  items: ProjectSkill[];
  diagnostics: Array<{ level: string; message: string; path?: string }>;
};

export function fetchProjectSkills(projectId: string): Promise<ProjectSkillsResponse> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills`));
}

export function fetchProjectSkill(projectId: string, skillId: string): Promise<{ ok: true; skill: ProjectSkill }> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(skillId)}`));
}

export function uploadProjectSkill(projectId: string, file: File): Promise<{ ok: true; skill: ProjectSkill }> {
  const body = new FormData();
  body.set('file', file);
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills/upload`), { method: 'POST', body });
}

export function installProjectSkillFromMarketplace(
  projectId: string,
  name: string,
  options: { provider?: string; version?: string } = {},
): Promise<{ ok: true; skill: ProjectSkill }> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills/marketplace/install`), {
    method: 'POST',
    body: JSON.stringify({ name, ...options }),
  });
}

export function installProjectSkillFromSource(projectId: string, source: string): Promise<{ ok: true; skill: ProjectSkill }> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills/source/install`), {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export function deleteProjectSkill(projectId: string, skillId: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(skillId)}`), {
    method: 'DELETE',
  });
}
