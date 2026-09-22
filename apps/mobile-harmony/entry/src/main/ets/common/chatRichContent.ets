import { XopcArtifact, XopcChatBlock, XopcChatRow, XopcChatTool, XopcContentBlock, XopcHistoryMedia,
  XopcProductDelivery, XopcProductReference, XopcTurnOutcome, XopcReviewFinding, XopcMessage, XopcAudioCandidate, XopcAudioWire } from '../model/chat';
import { markdownLink } from './markdown';

export function chatReview(raw?: XopcContentBlock): XopcContentBlock | undefined {
  if (!raw || raw.type !== 'review') return undefined;
  const findings = (Array.isArray(raw.findings) ? raw.findings : []).filter((finding: XopcReviewFinding): boolean =>
    !!finding && typeof finding.title === 'string' && typeof finding.body === 'string' && Number.isInteger(finding.priority) && finding.priority >= 0 && finding.priority <= 3);
  return { type: 'review', target: typeof raw.target === 'string' ? raw.target : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '', findings,
    overallCorrectness: typeof raw.overallCorrectness === 'string' ? raw.overallCorrectness : '',
    overallExplanation: typeof raw.overallExplanation === 'string' ? raw.overallExplanation : '' };
}

export function chatAnswerText(row: XopcChatRow): string {
  if (!row.blocks) return row.text;
  return row.blocks.filter((block: XopcChatBlock): boolean => block.kind === 'text' && block.presentation !== 'narration')
    .map((block: XopcChatBlock): string => block.text).join('\n').trim();
}

export function chatProductCapability(reference: XopcProductReference | undefined, capability: string): boolean {
  return !!reference && Array.isArray(reference.capabilities) && reference.capabilities.includes(capability);
}

export function chatResultText(result?: Object): string {
  if (result === undefined || result === null) return '';
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export function chatMedia(block: XopcContentBlock, id: string): XopcHistoryMedia | undefined {
  const mime = block.mimeType || block.source?.media_type || (block.type === 'image' ? 'image/png' : 'audio/mpeg');
  let uri = block.uri || block.source?.data || block.data || '';
  if (uri && !/^(data:|https?:|media:|xopc-file:|\/)/i.test(uri)) uri = 'data:' + mime + ';base64,' + uri.replace(/\s/g, '');
  if (!uri && !block.workspaceRelativePath) return undefined;
  return { id, name: block.name || (block.type === 'image' ? 'image' : 'audio'), type: block.type,
    mimeType: mime, size: 0, uri, workspaceRelativePath: block.workspaceRelativePath };
}

function firstAudioString(items: (string | undefined)[]): string {
  return items.find((item: string | undefined): boolean => typeof item === 'string' && !!item.trim())?.trim() || '';
}

export function chatHistoryAudio(message: XopcMessage, prefix: string): XopcHistoryMedia[] {
  const candidates: XopcAudioCandidate[] = [];
  for (const group of [message.ttsAudio, message.tts_audio, message.tts, message.audio]) {
    if (Array.isArray(group)) group.forEach((item: XopcAudioCandidate): void => { candidates.push(item); });
    else if (group !== undefined) candidates.push(group);
  }
  const uri = firstAudioString([message.ttsAudioUri, message.tts_audio_uri, message.audioUri, message.audio_url]);
  if (uri) candidates.push({ uri, mimeType: firstAudioString([message.mimeType, message.mime_type]), name: message.name });
  const output: XopcHistoryMedia[] = [];
  for (const candidate of candidates) {
    if (!candidate || (typeof candidate !== 'string' && typeof candidate !== 'object')) continue;
    const raw: XopcAudioWire = typeof candidate === 'string' ? { uri: candidate } : candidate;
    const mime = firstAudioString([raw.mimeType, raw.mime_type]) || 'audio/mpeg';
    const data = firstAudioString([raw.data]);
    const source = firstAudioString([raw.uri, raw.url, raw.audioUri, raw.audio_url])
      || (data ? data.startsWith('data:') ? data : 'data:' + mime + ';base64,' + data.replace(/\s/g, '') : '');
    const workspace = firstAudioString([raw.workspaceRelativePath, raw.workspace_relative_path, raw.path]);
    if (!source && !workspace) continue;
    output.push({ id: prefix + ':audio:' + output.length, name: firstAudioString([raw.name]) || 'voice.mp3',
      type: 'audio', mimeType: mime, size: 0, uri: source, workspaceRelativePath: workspace || undefined });
  }
  return output;
}

export function chatAttachments(files: XopcHistoryMedia[], prefix: string): XopcHistoryMedia[] {
  const output = new Map<string, XopcHistoryMedia>();
  for (const file of files) {
    if (!file || typeof file !== 'object') continue;
    const name = typeof file.name === 'string' ? file.name : 'attachment';
    let mime = typeof file.mimeType === 'string' ? file.mimeType : '';
    if (!mime || mime === 'application/octet-stream') {
      const extension = name.toLowerCase().split('.').pop() || '';
      const known: Record<string, string> = { 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif',
        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'mp4': 'video/mp4', 'txt': 'text/plain', 'md': 'text/markdown',
        'html': 'text/html', 'htm': 'text/html', 'csv': 'text/csv', 'xml': 'application/xml', 'pdf': 'application/pdf', 'json': 'application/json',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      mime = known[extension] || 'application/octet-stream';
    }
    let uri = typeof file.uri === 'string' ? file.uri : '';
    if (!uri && typeof file.data === 'string' && file.data) uri = file.data.startsWith('data:') ? file.data : 'data:' + mime + ';base64,' + file.data;
    const workspace = typeof file.workspaceRelativePath === 'string' ? file.workspaceRelativePath : undefined;
    const id = typeof file.id === 'string' && file.id ? file.id : prefix + ':' + output.size;
    const key = uri || workspace || id;
    const type = /^(image|audio|video)\//.test(mime) ? mime.split('/')[0] : typeof file.type === 'string' ? file.type : 'document';
    output.set(key, { id, name, mimeType: mime, type, size: typeof file.size === 'number' ? file.size : 0, uri,
      fileId: typeof file.fileId === 'string' ? file.fileId : undefined, workspaceRelativePath: workspace,
      extractedText: typeof file.extractedText === 'string' ? file.extractedText : undefined });
  }
  return Array.from(output.values());
}

export function chatOutcome(raw?: XopcTurnOutcome): XopcTurnOutcome | undefined {
  if (!raw || raw.version !== 1 || typeof raw.outcomeId !== 'string' || !Array.isArray(raw.deliverables)) return undefined;
  const items = new Map<string, XopcArtifact>();
  for (const artifact of raw.deliverables) {
    if (!artifact || typeof artifact.artifactId !== 'string' || typeof artifact.title !== 'string'
      || typeof artifact.kind !== 'string' || !['available', 'materializing', 'expired', 'missing', 'failed'].includes(artifact.availability)) continue;
    if ((artifact.uri !== undefined && typeof artifact.uri !== 'string') || (artifact.mimeType !== undefined && typeof artifact.mimeType !== 'string')
      || (artifact.workspaceRelativePath !== undefined && typeof artifact.workspaceRelativePath !== 'string') || (artifact.shareUrl !== undefined && typeof artifact.shareUrl !== 'string')) continue;
    const key = artifact.sourceFileId || artifact.artifactId;
    const old = items.get(key);
    if (!old || artifact.availability === 'available' || old.availability !== 'available') items.set(key, artifact);
  }
  return { version: 1, outcomeId: raw.outcomeId, runId: raw.runId, turnId: raw.turnId, status: raw.status,
    summary: raw.summary, deliverables: Array.from(items.values()) };
}

export function artifactMedia(artifact: XopcArtifact): XopcHistoryMedia {
  return { id: artifact.artifactId, name: artifact.title, type: artifact.kind,
    mimeType: artifact.mimeType || (artifact.kind === 'image' ? 'image/png' : 'application/octet-stream'),
    size: artifact.sizeBytes || 0, uri: artifact.uri || '', fileId: artifact.sourceFileId,
    workspaceRelativePath: artifact.workspaceRelativePath };
}

interface XopcToolOutputEnvelope { text?: string; content?: XopcContentBlock[]; details?: Object; delivery?: XopcProductDelivery; }
function deliveryRecord(raw?: Object): XopcProductDelivery | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const envelope = raw as XopcToolOutputEnvelope;
  const delivery = envelope.delivery || raw as XopcProductDelivery;
  if (delivery.version === 1 && ['created', 'updated', 'opened', 'started', 'completed', 'failed'].includes(delivery.operation)
    && delivery.primary && typeof delivery.primary.id === 'string' && typeof delivery.primary.title === 'string'
    && ['task', 'project', 'note', 'automation', 'session', 'file', 'settings', 'workflow_run', 'workflow_definition', 'local_app'].includes(delivery.primary.kind)) return delivery;
  return envelope.details && envelope.details !== raw ? deliveryRecord(envelope.details) : undefined;
}

export function toolOutputText(call: XopcChatTool): string {
  const details = call.details as XopcToolDetails | undefined;
  if (typeof details?.aggregatedOutput === 'string') return details.aggregatedOutput;
  if (typeof details?.diff === 'string') return details.diff;
  try {
    const parsed = JSON.parse(call.result || '') as XopcToolOutputEnvelope;
    if (parsed && Array.isArray(parsed.content)) return parsed.content.filter((part: XopcContentBlock): boolean => part?.type === 'text')
      .map((part: XopcContentBlock): string => part.text || '').join('\n');
    if (parsed && typeof parsed.text === 'string') return parsed.text;
  } catch (_) {}
  return call.result || '';
}

export interface XopcSearchLink { url: string; title: string; }
interface XopcToolDetails { kind?: string; aggregatedOutput?: string; diff?: string; results?: XopcSearchLink[]; details?: XopcToolDetails; }
export function chatSearchLinks(call: XopcChatTool): XopcSearchLink[] {
  if (!chatToolKey(call.name).includes('search')) return [];
  let details = call.details as XopcToolDetails | undefined;
  if (!details?.results) { try { const raw = JSON.parse(call.result || '') as XopcToolDetails; details = raw?.details || raw; } catch (_) {} }
  const found = new Map<string, XopcSearchLink>();
  for (const link of Array.isArray(details?.results) ? details!.results! : []) {
    if (!link || typeof link.url !== 'string' || !markdownLink(link.url)) continue;
    found.set(link.url, { url: link.url, title: typeof link.title === 'string' && link.title.trim() ? link.title : link.url });
  }
  return Array.from(found.values());
}

export function chatDeliveries(row: XopcChatRow): XopcProductDelivery[] {
  const results = new Map<string, XopcProductDelivery>();
  for (const call of row.toolCalls || []) {
    if (call.isError || call.status === 'running' || (call.result === undefined && call.status !== 'done')) continue;
    let delivery = deliveryRecord(call.details);
    if (!delivery) { try { delivery = deliveryRecord(JSON.parse(call.result || '') as Object); } catch (_) {} }
    if (!delivery) {
      const marker = toolOutputText(call).split(/\s+/).find((part: string): boolean => part.startsWith('xopc-product-delivery:'));
      if (marker) { try { delivery = deliveryRecord(JSON.parse(decodeURIComponent(marker.slice(22))) as Object); } catch (_) {} }
    }
    if (delivery?.primary && delivery.primary.kind !== 'file') results.set(delivery.operation + ':' + delivery.primary.kind + ':' + delivery.primary.id, delivery);
  }
  return Array.from(results.values());
}

export function refreshChatRow(row: XopcChatRow): XopcChatRow {
  const blocks = row.blocks || [];
  row.text = blocks.filter((block: XopcChatBlock): boolean => block.kind === 'text').map((block: XopcChatBlock): string => block.text).join('\n').trim();
  row.thinking = blocks.filter((block: XopcChatBlock): boolean => block.kind === 'thinking').map((block: XopcChatBlock): string => block.text).join('\n').trim();
  row.toolCalls = blocks.filter((block: XopcChatBlock): boolean => !!block.call).map((block: XopcChatBlock): XopcChatTool => block.call!);
  row.tools = row.toolCalls.map((call: XopcChatTool): string => call.name + '\n' + chatResultText(call.input) + '\n' + (call.result || '')).join('\n').trim();
  return row;
}

// Retain segment identity; never fold distinct turns even if a user row is outside the current page.
export function mergeAssistantRows(rows: XopcChatRow[]): XopcChatRow[] {
  const output: XopcChatRow[] = [];
  for (const row of rows) {
    const previous = output[output.length - 1];
    if (!row.sourceIds) row.sourceIds = [row.id];
    if (row.role !== 'assistant' || previous?.role !== 'assistant' || (row.turnId && previous.turnId && row.turnId !== previous.turnId)) {
      output.push(row); continue;
    }
    const blocks = previous.blocks || [];
    for (const block of row.blocks || []) {
      const index = blocks.findIndex((old: XopcChatBlock): boolean => old.id === block.id);
      if (index < 0) blocks.push(block); else blocks[index] = block;
    }
    previous.blocks = blocks; previous.outcome = row.outcome || previous.outcome; previous.turnId = row.turnId || previous.turnId;
    previous.sourceIds = Array.from(new Set<string>((previous.sourceIds || [previous.id]).concat(row.sourceIds)));
    const media = previous.media || [];
    previous.media = media.concat((row.media || []).filter((file: XopcHistoryMedia): boolean => !media.some((old: XopcHistoryMedia): boolean => old.uri === file.uri && old.id === file.id)));
    refreshChatRow(previous);
  }
  return output;
}

export function chatActivities(row: XopcChatRow, reasoning: string): XopcChatBlock[] {
  return (row.blocks || []).filter((block: XopcChatBlock): boolean => block.kind === 'tool' || block.kind === 'plan' || block.kind === 'diff'
    || (reasoning !== 'off' && block.kind === 'thinking' && (!!block.text.trim() || !!block.active)));
}

export function chatAnswerStarted(row: XopcChatRow): boolean {
  return (row.blocks || []).some((block: XopcChatBlock): boolean => block.kind === 'text' && block.presentation !== 'narration' && !!block.text.trim());
}

export function chatToolKey(name: string): string { return name.split('__').pop() || name; }
interface XopcToolInputPreview { path?: string; file_path?: string; command?: string; cmd?: string; query?: string; url?: string; pattern?: string; }
export function chatToolPreview(call: XopcChatTool): string {
  let input = call.input;
  if (typeof input === 'string') { const text = input; try { input = JSON.parse(text) as Object; } catch (_) { return text.slice(0, 160); } }
  const details = input as XopcToolInputPreview | undefined;
  if (!details || typeof details !== 'object') return '';
  const value = details.query || details.path || details.file_path || details.command || details.cmd || details.url || details.pattern;
  return typeof value === 'string' ? value.slice(0, 160) : '';
}
