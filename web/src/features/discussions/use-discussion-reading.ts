import { useCallback, useLayoutEffect, useState } from 'react';

import type { DiscussionDetail } from './discussion-types';

function revision(detail: DiscussionDetail): string {
  return JSON.stringify([detail.transcript.revision, detail.transcript.segments.map(segment => [segment.sequence,segment.revision,segment.status]), detail.organization?.revision]);
}

/** Publish live text without interrupting the current reading position. */
export function useDiscussionReading(noteId: string, latest: DiscussionDetail | null | undefined, beforePublish: () => void, editing = false) {
  const [snapshot, setSnapshot] = useState<{ noteId: string; version: string; value: DiscussionDetail }>();
  useLayoutEffect(() => {
    if (!editing && latest && (snapshot?.noteId !== noteId || snapshot.version !== revision(latest))) {
      if (snapshot?.noteId === noteId) beforePublish();
      setSnapshot({ noteId, version: revision(latest), value: latest });
    }
  }, [noteId,latest,snapshot?.noteId,snapshot?.version,beforePublish,editing]);
  const publish = useCallback((value: DiscussionDetail | null | undefined = latest) => {
    if (value) { beforePublish(); setSnapshot({ noteId, version: revision(value), value }); }
  }, [noteId,latest,beforePublish]);
  const current = snapshot?.noteId === noteId ? snapshot : undefined;
  const hasUpdates = !!latest && !!current && current.version !== revision(latest);
  const detail = latest && current ? { ...latest, transcript: current.value.transcript, organization: current.value.organization } : latest;
  return { detail, hasUpdates, publish };
}
