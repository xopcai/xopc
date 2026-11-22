export function hasMcpAuthorizationHeader(headers: unknown): boolean {
  return Boolean(headers && typeof headers === 'object'
    && Object.keys(headers).some(name => name.toLowerCase() === 'authorization'));
}
