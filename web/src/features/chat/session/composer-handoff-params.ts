import { isValidSkillWireId } from '@/features/chat/palette/skill-wire-pattern';
import type { NewSessionProjectIntent } from '@xopcai/gateway-contract';

export function buildComposerDraftSeed(skill: string, draft: string): string | null {
  const trimmedSkill = skill.trim();
  const trimmedDraft = draft.trim();
  if (trimmedSkill && isValidSkillWireId(trimmedSkill)) {
    return `/skill:${trimmedSkill}${trimmedDraft ? ` ${trimmedDraft}` : ' '}`;
  }
  return trimmedDraft || null;
}

export function newChatAutoSendHref(
  draft: string,
  attachmentsHandoff?: string,
  options?: { projectScope?: 'none' | 'remember-last' },
): string | null {
  const trimmedDraft = draft.trim();
  const trimmedAttachmentsHandoff = attachmentsHandoff?.trim() ?? '';
  if (!trimmedDraft && !trimmedAttachmentsHandoff) return null;
  const params = new URLSearchParams();
  if (trimmedDraft) params.set('draft', trimmedDraft);
  params.set('autoSend', '1');
  if (trimmedAttachmentsHandoff) params.set('attachmentsHandoff', trimmedAttachmentsHandoff);
  if (options?.projectScope === 'none') params.set('projectScope', 'none');
  return `/chat/new?${params.toString()}`;
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
  const attachmentsHandoff = sp.get('attachmentsHandoff');
  if (skill) next.set('skill', skill);
  if (slash) next.set('slash', slash);
  if (draft) next.set('draft', draft);
  if (autoSend === '1') next.set('autoSend', '1');
  if (attachmentHandoff) next.set('attachmentHandoff', attachmentHandoff);
  if (attachmentsHandoff) next.set('attachmentsHandoff', attachmentsHandoff);
  const out = next.toString();
  return out ? `?${out}` : '';
}

/** Project scope is consumed while creating `/chat/new`; it must not leak into the final chat URL. */
export function projectIntentForNewChatHandoff(search: string): NewSessionProjectIntent {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const projectId = params.get('projectId')?.trim();
  if (projectId) return { kind: 'project', projectId };
  if (params.get('projectScope') === 'none') return { kind: 'none' };
  return { kind: 'remember-last' };
}

export function newChatHrefForProject(projectId: string | null | undefined): string {
  const normalized = projectId?.trim();
  return normalized
    ? `/chat/new?projectId=${encodeURIComponent(normalized)}`
    : '/chat/new?projectScope=none';
}
