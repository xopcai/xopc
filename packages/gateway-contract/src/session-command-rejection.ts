/** Only explicit pre-acceptance failures allow a client to replace its frozen command. */
export function isSessionCommandRejected(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 409 && status !== 410) return false;
  const code = (body as { error?: { code?: string } } | null)?.error?.code;
  return typeof code === 'string' && [
    'BAD_REQUEST', 'CONFIG_CHANGED', 'SESSION_CHANGED', 'SESSION_DELETED', 'SESSION_BUSY', 'QUEUE_FULL',
  ].includes(code);
}
