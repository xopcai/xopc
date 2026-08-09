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
  const autoSend = sp.get('autoSend');
  const attachmentHandoff = sp.get('attachmentHandoff');
  if (skill) next.set('skill', skill);
  if (slash) next.set('slash', slash);
  if (draft) next.set('draft', draft);
  if (autoSend === '1') next.set('autoSend', '1');
  if (attachmentHandoff) next.set('attachmentHandoff', attachmentHandoff);
  const out = next.toString();
  return out ? `?${out}` : '';
}

/** Project scope is consumed while creating `/chat/new`; it must not leak into the final chat URL. */
export function projectIdForNewChatHandoff(search: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const projectId = new URLSearchParams(raw).get('projectId')?.trim();
  return projectId || null;
}
