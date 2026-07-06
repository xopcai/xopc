import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { apiFetch } from '../../api/client';
import type { NoteAttachment } from '../../query/notes';
import { AttachmentFileError, pickAttachmentFromSource, type AttachmentPickSource } from '../chat/attachment-file-io';
import type { EditorAttachmentPickResult } from '../notes/editor/editor-protocol';
import { prepareVoiceCapturePayload } from '../notes/capture-note-media';
import {
  createLocalNoteAttachment,
  displaySrcForLocalNoteAttachmentRef,
  parseLocalNoteAttachmentRef,
} from '../notes/notes-local-attachments';
import type { VoiceCapturePayload } from '../notes/use-voice-capture-interaction';
import type { AttachmentDisplaySeed } from './useNoteEditSession';

function noteAttachmentRef(noteId: string, attachmentId: string): string {
  return `xopc-attachment://notes/${encodeURIComponent(noteId)}/${encodeURIComponent(attachmentId)}`;
}

function attachmentApiPath(noteId: string, attachmentId: string): string {
  return `/api/notes/${encodeURIComponent(noteId)}/media/${encodeURIComponent(attachmentId)}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return globalThis.btoa(binary);
}

function isImageAttachment(attachment: NoteAttachment): boolean {
  return attachment.type === 'image' || attachment.mimeType.startsWith('image/');
}

type UseNoteEditorAttachmentsArgs = {
  id: string | undefined;
  setSnackMsg: Dispatch<SetStateAction<string>>;
  displaySeed: AttachmentDisplaySeed;
  messages: {
    actionFailed: string;
    added: string;
    permissionDenied: string;
    cameraDenied: string;
  };
};

export function useNoteEditorAttachments({
  id,
  setSnackMsg,
  displaySeed,
  messages,
}: UseNoteEditorAttachmentsArgs) {
  const [attachmentSrcMap, setAttachmentSrcMap] = useState<Record<string, string>>({});

  const resolveAttachmentRefsForDisplay = useCallback(async (
    currentNoteId: string,
    nextMarkdown: string,
    nextAttachments: NoteAttachment[] | undefined,
  ): Promise<Record<string, string>> => {
    const refPattern = /xopc-attachment:\/\/notes\/([^/\s)]+)\/([^\s)]+)/g;
    const localRefPattern = /xopc-local-attachment:\/\/notes\/([^/\s)]+)\/([^\s)]+)/g;
    const refs = new Map<string, { noteId: string; attachmentId: string }>();
    for (const match of nextMarkdown.matchAll(refPattern)) {
      const canonical = match[0];
      refs.set(canonical, {
        noteId: decodeURIComponent(match[1]),
        attachmentId: decodeURIComponent(match[2]),
      });
    }
    const nextMap: Record<string, string> = {};
    for (const match of nextMarkdown.matchAll(localRefPattern)) {
      const localRef = match[0];
      const parsed = parseLocalNoteAttachmentRef(localRef);
      if (!parsed) continue;
      const displaySrc = displaySrcForLocalNoteAttachmentRef(localRef);
      if (displaySrc) nextMap[localRef] = displaySrc;
    }
    for (const attachment of nextAttachments ?? []) {
      if (!isImageAttachment(attachment)) continue;
      refs.set(noteAttachmentRef(currentNoteId, attachment.id), {
        noteId: currentNoteId,
        attachmentId: attachment.id,
      });
    }

    for (const [canonical, ref] of refs) {
      if (!ref.noteId || !ref.attachmentId) continue;
      try {
        const res = await apiFetch(attachmentApiPath(ref.noteId, ref.attachmentId));
        if (!res.ok) continue;
        const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
        const dataUri = `data:${contentType};base64,${arrayBufferToBase64(await res.arrayBuffer())}`;
        nextMap[canonical] = dataUri;
      } catch {
        continue;
      }
    }
    return nextMap;
  }, []);

  useEffect(() => {
    if (!displaySeed) {
      setAttachmentSrcMap({});
      return;
    }
    let cancelled = false;
    setAttachmentSrcMap({});
    void resolveAttachmentRefsForDisplay(displaySeed.noteId, displaySeed.markdown, displaySeed.attachments).then((nextMap) => {
      if (!cancelled) setAttachmentSrcMap(nextMap);
    });
    return () => {
      cancelled = true;
    };
  }, [displaySeed, resolveAttachmentRefsForDisplay]);

  const handleRequestAttachment = useCallback(async (source: AttachmentPickSource): Promise<EditorAttachmentPickResult> => {
    if (!id) return null;
    try {
      const picked = await pickAttachmentFromSource(source);
      if (!picked) return null;
      const local = createLocalNoteAttachment(id, picked);
      if (local.displaySrc) {
        setAttachmentSrcMap((current) => ({ ...current, [local.src]: local.displaySrc! }));
      }
      setSnackMsg(messages.added);
      return {
        src: local.src,
        displaySrc: local.displaySrc,
        alt: picked.name,
        kind: picked.type === 'image' || picked.mimeType.startsWith('image/') ? 'image' : 'document',
      };
    } catch (error) {
      if (error instanceof AttachmentFileError && error.code === 'permission_denied') {
        setSnackMsg(source === 'camera' ? messages.cameraDenied : messages.permissionDenied);
        return null;
      }
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
      return null;
    }
  }, [id, messages, setSnackMsg]);

  const handleCreateVoiceAttachment = useCallback(async (payload: VoiceCapturePayload): Promise<EditorAttachmentPickResult> => {
    if (!id) return null;
    try {
      const queued = await prepareVoiceCapturePayload(payload);
      const local = createLocalNoteAttachment(id, {
        type: 'audio',
        name: queued.name,
        mimeType: queued.mimeType,
        size: queued.size,
        content: queued.content,
        localUri: queued.localUri,
        durationSeconds: Math.max(1, Math.round(queued.durationMillis / 1000)),
        transcript: queued.transcript,
      });
      setSnackMsg(messages.added);
      return {
        src: local.src,
        alt: queued.name,
        kind: 'audio',
        transcript: queued.transcript,
      };
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
      return null;
    }
  }, [id, messages.actionFailed, messages.added, setSnackMsg]);

  return {
    attachmentSrcMap,
    handleCreateVoiceAttachment,
    handleRequestAttachment,
  };
}
