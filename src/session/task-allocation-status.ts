/** Routine allocation receipts remain available for audit, outside the conversation. */
export function isRoutineTaskAllocationStatus(details: unknown): boolean {
  if (!details || typeof details !== 'object') return false;
  const allocation = (details as Record<string, unknown>).allocation;
  if (!allocation || typeof allocation !== 'object') return false;
  const status = (allocation as Record<string, unknown>).status;
  return status === 'pending' || status === 'selecting' || status === 'assigned';
}
