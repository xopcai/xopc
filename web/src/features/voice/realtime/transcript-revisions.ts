type TranscriptRevision = { revision: number; final: boolean };

/** Final text may share a revision with its last delta; a final is never replaced by a delta. */
export function acceptTranscriptRevision(
  revisions: Map<string, TranscriptRevision>,
  id: string,
  revision: number,
  final: boolean,
): boolean {
  const previous = revisions.get(id);
  if (previous && (revision < previous.revision || (previous.final && !final)
    || (revision === previous.revision && (previous.final || !final)))) return false;
  if (!revisions.has(id) && revisions.size >= 256) {
    const oldest = revisions.keys().next().value;
    if (oldest !== undefined) revisions.delete(oldest);
  }
  revisions.set(id, { revision, final });
  return true;
}
