import { listLocalAnnotations } from './discussion-annotation-store';
import { getDiscussionDraftChunk } from './discussion-draft-store';
import type { DiscussionDraft } from './discussion-types';

function tarHeader(name: string, size: number): Uint8Array {
  const bytes = new Uint8Array(512);
  const write = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  write(0, name); write(100, '0000600\0'); write(108, '0000000\0'); write(116, '0000000\0');
  write(124, size.toString(8).padStart(11, '0') + '\0'); write(136, '00000000000\0');
  bytes.fill(32, 148, 156); write(156, '0'); write(257, 'ustar\0'); write(263, '00');
  write(148, bytes.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ');
  return bytes;
}

/** Each original chunk is exported independently, including damaged/gapped drafts. */
export async function* recordingRecoveryArchive(draft: DiscussionDraft): AsyncGenerator<Uint8Array> {
  const entries: { index: number; bytes?: number; sha256?: string; missing?: boolean }[] = [];
  for (let index = 0; index < draft.chunkCount; index++) {
    const chunk = await getDiscussionDraftChunk(draft.id, index);
    if (!chunk) { entries.push({ index, missing: true }); continue; }
    const data = new Uint8Array(await chunk.blob.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', data);
    entries.push({ index, bytes: data.length, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') });
    yield tarHeader(`chunks/${String(index).padStart(6, '0')}.bin`, data.length); yield data;
    if (data.length % 512) yield new Uint8Array(512 - data.length % 512);
  }
  let annotationReadError: string | undefined;
  const annotations = await listLocalAnnotations(draft.id).catch(error => { annotationReadError = String(error); return []; });
  const data = new TextEncoder().encode(JSON.stringify({ version: 1, draft, chunks: entries, annotations, annotationReadError,
    reconstruction: 'Concatenate chunk bytes in index order within each epoch only. Epochs are independent containers. Missing chunks must never be skipped when reconstructing media.' }, null, 2));
  yield tarHeader('manifest.json', data.length); yield data;
  if (data.length % 512) yield new Uint8Array(512 - data.length % 512);
  yield new Uint8Array(1024);
}

export function canExportOriginal(draft: DiscussionDraft): boolean {
  return (draft.epochs?.length ?? 1) === 1 && draft.saveOutcome === 'complete'
    && draft.mediaCoverage?.status === 'verified' && draft.mediaCoverage.committedChunkCount === draft.chunkCount
    && draft.mediaCoverage.verifiedThroughMs > 0;
}

export async function* originalRecordingBytes(draft: DiscussionDraft): AsyncGenerator<Uint8Array> {
  for (let index = 0; index < draft.chunkCount; index++) {
    const chunk = await getDiscussionDraftChunk(draft.id, index);
    if (!chunk) throw new Error('Original audio has missing chunks; export a recovery package instead.');
    const reader = chunk.blob.stream().getReader();
    try {
      while (true) { const next = await reader.read(); if (next.done) break; yield next.value; }
    } finally { reader.releaseLock(); }
  }
}

type ExportWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }> };
export async function exportLocalRecording(draft: DiscussionDraft): Promise<void> {
  const picker = (window as ExportWindow).showSaveFilePicker;
  const localMarks = await listLocalAnnotations(draft.id).catch(() => null);
  const original = canExportOriginal(draft) && localMarks !== null && localMarks.length === 0;
  const extension = draft.mimeType.includes('mp4') ? 'm4a' : draft.mimeType.includes('ogg') ? 'ogg' : 'webm';
  const name = `recording-${draft.id}.${original ? extension : 'tar'}`;
  const bytes = () => original ? originalRecordingBytes(draft) : recordingRecoveryArchive(draft);
  if (picker) {
    const handle = await picker.call(window, { suggestedName: name });
    const output = await handle.createWritable();
    try { for await (const part of bytes()) await output.write(part); await output.close(); }
    catch (error) { await output.abort().catch(() => undefined); throw error; }
    return;
  }
  const parts: BlobPart[] = [];
  let size = 0;
  for await (const part of bytes()) {
    size += part.length;
    if (size > 64 * 1024 * 1024) throw new Error('Use Chrome or Edge file saving to export recordings over 64 MB. Your original audio is retained.');
    parts.push(part as Uint8Array<ArrayBuffer>);
  }
  const url = URL.createObjectURL(new Blob(parts, { type: original ? draft.mimeType : 'application/x-tar' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
