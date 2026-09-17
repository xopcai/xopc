import type { FileResource } from '@xopcai/gateway-contract';

import type { NoteIndexEntry } from '../../query/notes';
import type { LocalRecording } from '../recordings/recordings';

export type LibraryRecentItem = {
  id: string;
  kind: 'file' | 'note' | 'recording';
  title: string;
  updatedAt: number;
  route: string;
};

export function buildLibraryRecentItems(input: {
  files: FileResource[];
  notes: NoteIndexEntry[];
  recordings: LocalRecording[];
  untitledNote: string;
  recordingTitle: string;
  limit?: number;
}): LibraryRecentItem[] {
  const items: LibraryRecentItem[] = [
    ...input.files.filter(file => file.kind === 'file').map(file => ({
      id: `file:${file.id}`,
      kind: 'file' as const,
      title: file.name,
      updatedAt: file.modifiedAt,
      route: `/files/open/${encodeURIComponent(file.id)}`,
    })),
    ...input.notes.map(note => ({
      id: `note:${note.id}`,
      kind: 'note' as const,
      title: note.title || note.snippet || input.untitledNote,
      updatedAt: note.updatedAt,
      route: `/items/${encodeURIComponent(note.id)}`,
    })),
    ...input.recordings.map(recording => ({
      id: `recording:${recording.id}`,
      kind: 'recording' as const,
      title: input.recordingTitle,
      updatedAt: recording.recordedAt,
      route: '/recordings',
    })),
  ];
  return items.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, input.limit ?? 8);
}
