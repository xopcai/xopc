const guards = new Map<string, () => Promise<boolean>>();
export function registerFileCloseGuard(id: string, guard: () => Promise<boolean>) {
  guards.set(id, guard);
  return () => { if (guards.get(id) === guard) guards.delete(id); };
}
export async function canCloseFile(id: string) { return await guards.get(id)?.() ?? true; }
