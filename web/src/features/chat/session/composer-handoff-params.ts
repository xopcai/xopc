import { isValidSkillWireId } from '@/features/chat/palette/skill-wire-pattern';

export function buildComposerDraftSeed(skill: string, draft: string): string | null {
  const trimmedSkill = skill.trim();
  const trimmedDraft = draft.trim();
  if (trimmedSkill && isValidSkillWireId(trimmedSkill)) {
    return `/skill:${trimmedSkill}${trimmedDraft ? ` ${trimmedDraft}` : ' '}`;
  }
  return trimmedDraft || null;
}

/**
 * When `/chat/new?skill=…&slash=…` resolves to an actual session and the URL is
 * replaced with `/chat/:key?…`, only composer deep-link params should survive —
 * everything else (router state, agent params, etc.) belongs to the `/new` route.
 */
export function searchParamsForComposerHandoff(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return '';
  const sp = new URLSearchParams(raw);
  const next = new URLSearchParams();
  const skill = sp.get('skill');
  const slash = sp.get('slash');
  const draft = sp.get('draft');
  if (skill) next.set('skill', skill);
  if (slash) next.set('slash', slash);
  if (draft) next.set('draft', draft);
  const out = next.toString();
  return out ? `?${out}` : '';
}
