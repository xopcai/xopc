import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ProjectUnderstanding = {
  status: 'not_started' | 'queued' | 'probing' | 'analyzing' | 'completed' | 'failed' | 'canceled';
  overview: string | null;
  updatedAt: number | null;
};

const endpoint = (projectId: string) => apiUrl(`/api/projects/${encodeURIComponent(projectId)}/understanding`);

export function fetchProjectUnderstanding(projectId: string): Promise<ProjectUnderstanding> {
  return fetchJson(endpoint(projectId));
}

export function startProjectUnderstanding(projectId: string): Promise<{ status: ProjectUnderstanding['status'] }> {
  return fetchJson(endpoint(projectId), { method: 'POST' });
}

export function correctProjectUnderstanding(projectId: string, content: string) {
  return fetchJson(endpoint(projectId), { method: 'PATCH', body: JSON.stringify({ content }) });
}

export function isProjectUnderstandingRunning(status?: ProjectUnderstanding['status']) {
  return status === 'queued' || status === 'probing' || status === 'analyzing';
}
