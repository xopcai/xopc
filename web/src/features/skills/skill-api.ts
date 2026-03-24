import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import type { SkillsPayload } from '@/features/skills/skill.types';

async function readErrorMessage(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (typeof j.error === 'string') return j.error;
  if (j.error && typeof j.error === 'object' && 'message' in j.error) {
    const m = (j.error as { message?: string }).message;
    if (typeof m === 'string') return m;
  }
  return `HTTP ${res.status}`;
}

export async function getSkills(): Promise<SkillsPayload> {
  const res = await apiFetch(apiUrl('/api/skills'));
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: SkillsPayload };
  if (!data.payload) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

export async function reloadSkills(): Promise<void> {
  const res = await apiFetch(apiUrl('/api/skills/reload'), {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}

export async function uploadSkillZip(
  file: File,
  opts: { skillId?: string; overwrite?: boolean },
): Promise<{ skillId: string; path: string }> {
  const form = new FormData();
  form.append('file', file);
  if (opts.skillId) {
    form.append('skillId', opts.skillId);
  }
  if (opts.overwrite) {
    form.append('overwrite', 'true');
  }

  const token = useGatewayStore.getState().token;
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(apiUrl('/api/skills/upload'), {
    method: 'POST',
    headers,
    body: form,
  });

  if (res.status === 401) {
    useGatewayStore.getState().onUnauthorized();
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    payload?: { skillId: string; path: string };
  };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (!data.payload?.skillId) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

export async function deleteSkill(skillId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/skills/${encodeURIComponent(skillId)}`), {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}
