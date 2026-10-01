import { XopcChatRow, XopcChatBlock, XopcStreamPayload, XopcTurnOutcome, XopcProductDelivery, XopcLiveActivityTool } from '../model/chat';
import { chatOutcome, chatReview, refreshChatRow } from './chatRichContent';
import { reduceChatLiveActivity } from './chatLiveActivity';

/** Compact events reuse the existing run topic, replay cursor and lifecycle. */
export function reduceChatStream(previous: XopcChatRow | undefined, event: string, payload: XopcStreamPayload, runId: string): XopcChatRow {
  const row: XopcChatRow = previous ? { id: previous.id, role: previous.role, text: previous.text,
    refs: previous.refs, outcome: previous.outcome, turnId: previous.turnId, live: previous.live,
    progress: previous.progress, sourceIds: previous.sourceIds, deliveries: previous.deliveries,
    activity: previous.activity, activityUpdatedAtMs: previous.activityUpdatedAtMs,
    executionActivity: previous.executionActivity,
    activityTools: previous.activityTools?.map((item: XopcLiveActivityTool): XopcLiveActivityTool => ({ id: item.id, kind: item.kind, status: item.status })),
    media: previous.media?.slice(), blocks: previous.blocks?.map((block: XopcChatBlock): XopcChatBlock => ({
      id: block.id, kind: block.kind, text: block.text, segmentId: block.segmentId, presentation: block.presentation,
      review: block.review })) }
    : { id: 'live:' + runId, role: 'assistant', turnId: runId, text: '', blocks: [], live: true, executionActivity: true };
  row.executionActivity = true;
  const blocks = row.blocks || [];
  reduceChatLiveActivity(row, event, payload);
  if (event === 'assistant_delta') {
    const segment = payload.messageId || runId;
    let target = blocks.find((block: XopcChatBlock): boolean => block.kind === 'text' && block.segmentId === segment);
    if (payload.offset !== undefined && payload.offset !== (target?.text.length || 0)) return row;
    if (!target) {
      target = { id: segment + ':text', kind: 'text', text: '', segmentId: segment, presentation: 'pending' };
      blocks.push(target);
    }
    target.text += payload.delta || '';
  } else if (event === 'assistant_message_end') {
    blocks.forEach((block: XopcChatBlock): void => {
      if (block.kind === 'text' && (!payload.messageId || block.segmentId === payload.messageId)) {
        block.presentation = payload.presentation === 'narration' ? 'narration' : 'answer';
        if (block.presentation === 'narration') block.text = block.text.replace(/\s+/g, ' ').trim().slice(0, 160);
      }
    });
  } else if (event === 'tool_end' && payload.deliveries?.length) {
    const deliveries = new Map<string, XopcProductDelivery>();
    for (const delivery of (row.deliveries || []).concat(payload.deliveries)) deliveries.set(JSON.stringify(delivery), delivery);
    row.deliveries = Array.from(deliveries.values());
  } else if (event === 'tts_audio' && payload.uri) {
    const media = row.media || [];
    if (!media.some((file): boolean => file.uri === payload.uri)) media.push({ id: row.id + ':audio:' + media.length,
      name: payload.name || 'voice.mp3', type: 'audio', mimeType: payload.mimeType || 'audio/mpeg', size: 0, uri: payload.uri });
    row.media = media;
  } else if (event === 'review' && payload.review?.type === 'review') {
    const id = (payload.messageId || runId) + ':review';
    const index = blocks.findIndex((block: XopcChatBlock): boolean => block.id === id);
    const review: XopcChatBlock = { id, kind: 'review', text: '', review: chatReview(payload.review) };
    if (index < 0) blocks.push(review); else blocks[index] = review;
  } else if (event === 'turn_outcome') row.outcome = chatOutcome(payload as Object as XopcTurnOutcome);
  else if (event === 'progress') row.progress = '';
  else if (event === 'run_end') {
    row.live = false; row.progress = '';
    blocks.forEach((block: XopcChatBlock): void => {
      if (block.presentation === 'pending') block.presentation = 'answer';
    });
  }
  row.blocks = blocks;
  return refreshChatRow(row);
}
