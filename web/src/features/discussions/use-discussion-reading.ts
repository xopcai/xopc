import { useCallback, useEffect, useState } from 'react';

import type { DiscussionDetail } from './discussion-types';

function revision(detail: DiscussionDetail): string {
  return JSON.stringify([detail.transcript.revision, detail.transcript.segments.map(segment => [segment.sequence,segment.revision,segment.status]), detail.organization?.revision]);
}

/** Keep readable text stable while capture status and audio availability continue updating. */
export function useDiscussionReading(noteId: string, latest: DiscussionDetail | null | undefined) {
  const [snapshot, setSnapshot] = useState<{ noteId: string; version: string; value: DiscussionDetail }>();
  useEffect(() => {
    if (latest && snapshot?.noteId !== noteId) setSnapshot({ noteId, version: revision(latest), value: latest });
  }, [noteId,latest,snapshot?.noteId]);
  const publish = useCallback((value: DiscussionDetail | null | undefined = latest) => {
    if (value) setSnapshot({ noteId, version: revision(value), value });
  }, [noteId,latest]);
  const current = snapshot?.noteId === noteId ? snapshot : undefined;
  const hasUpdates = !!latest && !!current && current.version !== revision(latest);
  const detail = latest && current ? { ...latest, transcript: current.value.transcript, organization: current.value.organization } : latest;
  return { detail, hasUpdates, publish };
}
