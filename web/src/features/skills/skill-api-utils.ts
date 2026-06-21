export async function readSkillApiErrorMessage(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (typeof j.error === 'string') return j.error;
  if (j.error && typeof j.error === 'object' && 'message' in j.error) {
    const m = (j.error as { message?: string }).message;
    if (typeof m === 'string') return m;
  }
  return `HTTP ${res.status}`;
}
