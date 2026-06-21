import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { readSkillApiErrorMessage } from '@/features/skills/skill-api-utils';

import type { SkillsPayload } from '@/features/skills/skill.types';

export async function getSkills(): Promise<SkillsPayload> {
  const res = await apiFetch(apiUrl('/api/skills'), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: SkillsPayload };
  if (!data.payload) {
    throw new Error('Invalid response');
  }
  return data.payload;
}
