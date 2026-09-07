import {
  createNote, noteAttachmentRef, openNoteChat, updateNote, uploadNoteMedia,
  type Note, type NoteAttachment,
} from './notes-api';

export interface NoteCreationDraft {
  requestId: string;
  title: string;
  markdown: string;
  projectId?: string;
  files: File[];
  note?: Note;
  attachments: NoteAttachment[];
  materialHeading: string;
}

/** Retain completed steps so a failed upload or handoff can resume the same note. */
export async function prepareAgentNote(draft: NoteCreationDraft): Promise<{ noteId: string; sessionKey: string }> {
  draft.note ??= await createNote({
    title: draft.title, markdown: draft.markdown, projectId: draft.projectId, channel: 'web',
  }, draft.requestId);
  const noteId = draft.note.id;
  for (let index = draft.attachments.length; index < draft.files.length; index++) {
    draft.attachments.push(await uploadNoteMedia(noteId, draft.files[index], `${draft.requestId}:file:${index}`));
  }
  if (draft.attachments.length) {
    const references = draft.attachments.map((attachment) => {
      const label = attachment.fileName.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ');
      return `[${label}](${noteAttachmentRef(noteId, attachment.id)})`;
    });
    draft.note = await updateNote(noteId, {
      markdown: `${draft.markdown}\n\n## ${draft.materialHeading}\n\n${references.join('\n\n')}`,
    });
  }
  const chat = await openNoteChat(noteId, { projectId: draft.projectId });
  return { noteId, sessionKey: chat.sessionKey };
}

export function noteCreationChatHref(sessionKey: string, noteId: string, prompt: string): string {
  const search = new URLSearchParams({ draft: prompt.replace('{{id}}', noteId), autoSend: '1' });
  return `/chat/${encodeURIComponent(sessionKey)}?${search}`;
}
