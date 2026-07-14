export function shouldPreserveWorkspaceSearch(query: string): boolean {
  return query.trim().length > 0;
}
