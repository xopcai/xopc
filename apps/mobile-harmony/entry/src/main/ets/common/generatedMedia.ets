import { XopcChatRow } from '../model/chat';
import { XopcGeneratedMediaCard, XopcGeneratedMediaKind, XopcGeneratedMediaJobs } from '../model/generatedMedia';

export function generatedMediaPath(kind: XopcGeneratedMediaKind, conversationId: string): string {
  return '/api/' + kind + '-generation/sessions/' + encodeURIComponent(conversationId) + '/jobs';
}

export function generatedMediaCards(kind: XopcGeneratedMediaKind, response: XopcGeneratedMediaJobs): XopcGeneratedMediaCard[] {
  const cards = response.jobs.filter(item => kind === 'music' || item.transcriptId === response.transcriptId)
    .map((item): XopcGeneratedMediaCard => ({ kind, item, draft: false, canConfirm: false }));
  const draft = response.draft;
  if (kind === 'video' && draft && !cards.some((card: XopcGeneratedMediaCard): boolean => card.item.id === draft.id)) {
    cards.push({ kind, item: draft, draft: true,
      canConfirm: response.configured === true && !!response.modelRef && draft.modelRef === response.modelRef });
  }
  return cards;
}

export function generatedMediaByReply(cards: XopcGeneratedMediaCard[], rows: XopcChatRow[]): Map<string, XopcGeneratedMediaCard[]> {
  const anchors = new Map<string, string>();
  let latestReply = '';
  for (const row of rows) {
    if (row.role !== 'assistant') continue;
    latestReply = row.id;
    for (const id of row.generatedMediaIds ?? []) {
      if (!anchors.has(id)) anchors.set(id, row.id);
    }
  }
  const groups = new Map<string, XopcGeneratedMediaCard[]>();
  for (const card of cards) {
    const id = anchors.get(card.item.id) ?? latestReply;
    const group = groups.get(id) ?? [];
    group.push(card);
    groups.set(id, group);
  }
  return groups;
}

export function generatedMediaTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return Math.floor(total / 60).toString() + ':' + (total % 60).toString().padStart(2, '0');
}
