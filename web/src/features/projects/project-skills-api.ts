import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ProjectSkill = {
  key: string;
  directoryId: string;
  name: string;
  description: string;
  category?: string;
  origin: 'extra' | 'bundled' | 'agents-global' | 'agents-workspace' | 'custom-global' | 'xopc-global' | 'xopc-workspace';
  path: string;
  managed: boolean;
  writable: boolean;
  removable: boolean;
  effective: boolean;
  shadowedBy?: string;
  disableModelInvocation: boolean;
  bodyMarkdown?: string;
};

export type ProjectSkillSource = {
  origin: 'xopc-workspace' | 'agents-workspace';
  rootDir: string;
  managed: boolean;
  writable: boolean;
  state: 'active' | 'missing' | 'disabled' | 'untrusted' | 'invalid';
};

export type ProjectWorkspaceTrust = {
  workspacePath: string;
  required: boolean;
  decision: boolean | null;
  trusted: boolean;
};

export type ProjectSkillDiagnostic = {
  type: 'skipped' | 'warning' | 'collision' | 'error';
  message: string;
  path?: string;
};

export type ProjectSkillsResponse = {
  ok: true;
  workspaceRoot: string;
  sources: ProjectSkillSource[];
  trust: ProjectWorkspaceTrust;
  items: ProjectSkill[];
  inheritedItems: ProjectSkill[];
  diagnostics: ProjectSkillDiagnostic[];
};

export function fetchProjectSkills(projectId: string): Promise<ProjectSkillsResponse> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills`));
}

export function fetchProjectSkill(projectId: string, skillKey: string): Promise<{ ok: true; skill: ProjectSkill }> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(skillKey)}`));
}

export function setProjectWorkspaceTrust(projectId: string, trusted: boolean): Promise<{ ok: true; trust: ProjectWorkspaceTrust }> {
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/workspace-trust`), {
    method: 'PATCH',
    body: JSON.stringify({ trusted }),
  });
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
