import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { XopcAnnotationStore, XopcLocalAnnotation } from './discussionAnnotations';
import { XopcDiscussionRecordingStore, XopcLocalRecording } from './discussionRecordingStore';

function xopcRecordingTarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  const encoder = new util.TextEncoder();
  header.set(encoder.encodeInto(name), 0);
  header.set(encoder.encodeInto('0000600\0'), 100);
  header.set(encoder.encodeInto('0000000\0'), 108);
  header.set(encoder.encodeInto('0000000\0'), 116);
  header.set(encoder.encodeInto(size.toString(8).padStart(11, '0') + '\0'), 124);
  header.set(encoder.encodeInto('00000000000\0'), 136);
  header.fill(32, 148, 156); header[156] = 48;
  header.set(encoder.encodeInto('ustar\0'), 257); header.set(encoder.encodeInto('00'), 263);
  let checksum: number = 0;
  for (let index: number = 0; index < header.length; index++) checksum += header[index];
  header.set(encoder.encodeInto(checksum.toString(8).padStart(6, '0') + '\0 '), 148);
  return header;
}

async function xopcRecordingWrite(fd: number, bytes: Uint8Array): Promise<void> {
  const payload = new Uint8Array(bytes.byteLength); payload.set(bytes);
  if (await fs.write(fd, payload.buffer as ArrayBuffer) !== bytes.byteLength) throw new Error('INCOMPLETE_FILE_WRITE');
}

async function xopcRecordingTarEntry(fd: number, name: string, bytes: Uint8Array): Promise<void> {
  await xopcRecordingWrite(fd, xopcRecordingTarHeader(name, bytes.byteLength));
  await xopcRecordingWrite(fd, bytes);
  if (bytes.byteLength % 512) await xopcRecordingWrite(fd, new Uint8Array(512 - bytes.byteLength % 512));
}

/** Export one immutable WAV at a time; failure never removes the local source. */
export async function xopcExportRecording(context: common.UIAbilityContext, store: XopcDiscussionRecordingStore, session: XopcLocalRecording): Promise<void> {
  const options = new picker.DocumentSaveOptions(); options.newFileNames = ['recording-' + session.id + '.tar'];
  const uris = await new picker.DocumentViewPicker(context).save(options);
  if (!uris.length) return;
  const destination = await fs.open(uris[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try {
    const chunks = await store.chunks(session.id, false);
    const events = await store.events(session.id);
    const annotations = new XopcAnnotationStore(); let marks: XopcLocalAnnotation[] = []; let annotationReadError: string = '';
    try { await annotations.initialize(context); marks = await annotations.list(session.id); } catch (caught) { annotationReadError = (caught as Error).message; }
    const manifest = new util.TextEncoder().encodeInto(JSON.stringify({ version: 1, session: session, chunks: chunks, events: events, annotations: marks, annotationReadError: annotationReadError }));
    await xopcRecordingTarEntry(destination.fd, 'manifest.json', manifest);
    for (const chunk of chunks) {
      const wav = await store.audio(session.id, chunk.sequence);
      await xopcRecordingTarEntry(destination.fd, 'audio/' + chunk.sequence.toString().padStart(6, '0') + '.wav', wav);
    }
    await xopcRecordingWrite(destination.fd, new Uint8Array(1024));
  } finally { await fs.close(destination); }
}
