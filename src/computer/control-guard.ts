/** Process-local admission gate; authority itself remains in the desktop broker. */
const owners = new Map<string, () => Promise<void>>();
export function enterComputerControl(owner: string, close: () => Promise<void>): void { owners.set(owner, close); }
export function leaveComputerControl(owner: string): void { owners.delete(owner); }
export function isComputerControlActive(owner: string): boolean { return owners.has(owner); }
/** Built-in manuals are static, read-only text; they cannot operate another surface. */
export function isComputerLeaseTool(name: string): boolean { return ['computer_use', 'clarify', 'tool_manual'].includes(name); }
export async function stopComputerControl(owner: string): Promise<void> { await owners.get(owner)?.(); }
