/** Provenance coverage is a source-link diagnostic, not semantic answer-support recall. */
export function provenanceCoverage(goldRefs: string[], learning: any, auditItems: any[], toolText: string): any {
  const evidence = new Map(learning.evidence.map((row: any) => [row.evidence_id, learning.entryRefs[row.message_id]]));
  const links = [
    ...learning.assertionLinks.filter((r: any) => r.relation === 'supports').map((r: any) => ({ id: r.assertion_id, ref: evidence.get(r.evidence_id) })),
    ...learning.knowledgeLinks.map((r: any) => ({ id: r.knowledge_id, ref: evidence.get(r.evidence_id) })),
  ];
  const selected = new Set(auditItems.filter(r => r.included === 1).map(r => r.object_id));
  const collect = (predicate: (row: any) => boolean) => new Set(links.filter(predicate).map(r => r.ref));
  const stored = collect(() => true), injected = collect(r => selected.has(r.id));
  const tools = collect(r => toolText.includes(r.id));
  for (const [entryId, ref] of Object.entries(learning.entryRefs)) if (toolText.includes(entryId)) tools.add(ref);
  const score = (refs: Set<unknown>) => goldRefs.length ? goldRefs.filter(r => refs.has(r)).length/goldRefs.length : null;
  return { goldTurns: goldRefs.length, storedSourceCoverage: score(stored), injectedSourceCoverage: score(injected),
    toolSourceCoverage: score(tools), availableAfterToolsSourceCoverage: score(new Set([...injected, ...tools])),
    note: 'Exact source-link coverage; a linked source may contain multiple unrelated facts. Not semantic completeness or official Recall@k.' };
}
