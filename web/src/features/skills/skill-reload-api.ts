import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { readSkillApiErrorMessage } from '@/features/skills/skill-api-utils';

export async function reloadSkills(): Promise<void> {
  const res = await apiFetch(apiUrl('/api/skills/reload'), {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
  }
}
