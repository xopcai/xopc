const CONNECTOR_ECOSYSTEM: Readonly<Record<string, string>> = {
  'composio-gmail': 'google',
  'composio-googlecalendar': 'google',
  'composio-googledrive': 'google',
  'composio-googledocs': 'google',
  'composio-googlesheets': 'google',
  'composio-youtube': 'google',
  'composio-outlook': 'microsoft',
  'composio-microsoft_teams': 'microsoft',
  'composio-one_drive': 'microsoft',
  'composio-excel': 'microsoft',
};

/** Prioritize already-connected and same-ecosystem connectors while preserving catalog order on ties. */
export function rankConnectionCandidatesByEcosystem<T extends { candidateRef: string }>(
  candidates: readonly T[],
  activeConnectorIds: ReadonlySet<string>,
): T[] {
  if (candidates.length <= 1 || activeConnectorIds.size === 0) return [...candidates];
  const activeEcosystems = new Set<string>();
  for (const id of activeConnectorIds) {
    const ecosystem = CONNECTOR_ECOSYSTEM[id];
    if (ecosystem) activeEcosystems.add(ecosystem);
  }
  const score = (ref: string): number => {
    if (activeConnectorIds.has(ref)) return 4;
    const ecosystem = CONNECTOR_ECOSYSTEM[ref];
    return ecosystem && activeEcosystems.has(ecosystem) ? 2 : 0;
  };
  return candidates
    .map((candidate, index) => ({ candidate, index, score: score(candidate.candidateRef) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(item => item.candidate);
}
