/** Process-local admission gate; authority itself remains in the desktop broker. */
const owners = new Map<string, () => Promise<void>>();
export function enterComputerControl(owner: string, close: () => Promise<void>): void { owners.set(owner, close); }
export function leaveComputerControl(owner: string): void { owners.delete(owner); }
export function isComputerControlActive(owner: string): boolean { return owners.has(owner); }
export async function stopComputerControl(owner: string): Promise<void> { await owners.get(owner)?.(); }
