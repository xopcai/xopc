export function externalToolRef(source: string, namespace: string, toolName: string): string {
  return `${source}:${encodeURIComponent(namespace)}:${encodeURIComponent(toolName)}`;
}

export function parseExternalToolRef(
  toolRef: string,
  expectedSource: string,
): { namespace: string; toolName: string } | undefined {
  const parts = toolRef.split(':');
  if (parts.length !== 3 || parts[0] !== expectedSource) return undefined;
  try {
    return {
      namespace: decodeURIComponent(parts[1]!),
      toolName: decodeURIComponent(parts[2]!),
    };
  } catch {
    return undefined;
  }
}
