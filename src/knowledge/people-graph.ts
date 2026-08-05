import { listUserPeopleGraphRows } from '../storage/sqlite/index.js';

export type ConnectedPersonNode = {
  id: string;
  label: string;
  names: string[];
  emails: string[];
  usernames: string[];
  roles: string[];
  mentionCount: number;
  lastObservedAt: string;
};

export type ConnectedPersonSourceEdge = {
  personId: string;
  sourceInstanceId: string;
  connectorId?: string;
  toolkit?: string;
  mentionCount: number;
  lastObservedAt: string;
};

export type ConnectedPeopleGraph = {
  people: ConnectedPersonNode[];
  sourceEdges: ConnectedPersonSourceEdge[];
  scannedItems: number;
  truncated: boolean;
};

function sourceMetadata(sourceInstanceId: string): { connectorId?: string; toolkit?: string } {
  const parts = sourceInstanceId.split(':');
  if (parts[0] !== 'composio' || !parts[1]) return {};
  return {
    connectorId: parts[1],
    toolkit: parts[1].replace(/^composio-/, ''),
  };
}

export function buildConnectedPeopleGraph(options: { query?: string; limit?: number } = {}): ConnectedPeopleGraph {
  const graph = listUserPeopleGraphRows();
  const edgesByPerson = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const values = edgesByPerson.get(edge.entityId) ?? [];
    values.push(edge);
    edgesByPerson.set(edge.entityId, values);
  }
  const query = options.query?.trim().toLowerCase() ?? '';
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const matching = graph.people.map((entity) => {
    const edges = edgesByPerson.get(entity.id) ?? [];
    const names = [
      ...(entity.canonicalLabel.includes('@') ? [] : [entity.canonicalLabel]),
      ...entity.handles.filter((handle) => handle.type === 'display_name').map((handle) => handle.value),
    ].filter((value, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index).toSorted();
    const emails = entity.handles.filter((handle) => handle.type === 'email').map((handle) => handle.value).toSorted();
    const usernames = entity.handles.filter((handle) => handle.type === 'provider_user').map((handle) => handle.value).toSorted();
    return {
      id: entity.id,
      label: entity.canonicalLabel,
      names,
      emails,
      usernames,
      roles: [],
      mentionCount: edges.reduce((sum, edge) => sum + edge.mentionCount, 0),
      lastObservedAt: edges.reduce((latest, edge) => !latest || edge.lastObservedAt > latest ? edge.lastObservedAt : latest, '') || entity.updatedAt,
    };
  }).filter((person) => !query || [person.label, ...person.names, ...person.emails, ...person.usernames]
    .some((value) => value.toLowerCase().includes(query)))
    .toSorted((left, right) => right.mentionCount - left.mentionCount || right.lastObservedAt.localeCompare(left.lastObservedAt));
  const people = matching.slice(0, limit);
  const included = new Set(people.map((person) => person.id));
  return {
    people,
    sourceEdges: graph.edges.filter((edge) => included.has(edge.entityId)).map((edge) => ({
      personId: edge.entityId,
      sourceInstanceId: edge.sourceInstanceId,
      ...sourceMetadata(edge.sourceInstanceId),
      mentionCount: edge.mentionCount,
      lastObservedAt: edge.lastObservedAt,
    })),
    scannedItems: graph.evidenceCount,
    truncated: matching.length > limit,
  };
}
