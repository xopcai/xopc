export interface McpResourceIdentity {
  serverId: string;
  uri: string;
}

export function encodeMcpResourceId(identity: McpResourceIdentity): string {
  return Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url');
}

export function decodeMcpResourceId(sourceId: string): McpResourceIdentity | null {
  try {
    const value = JSON.parse(Buffer.from(sourceId, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof value.serverId !== 'string' || !value.serverId.trim()) return null;
    if (typeof value.uri !== 'string' || !value.uri.trim()) return null;
    return { serverId: value.serverId, uri: value.uri };
  } catch {
    return null;
  }
}
