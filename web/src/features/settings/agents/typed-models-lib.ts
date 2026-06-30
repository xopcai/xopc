export type AgentTypedModelRow = {
  id: string;
  description: string;
  model: string;
};

export const TYPED_MODEL_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

function isValidProviderModelRef(ref: string): boolean {
  const trimmed = ref.trim();
  const idx = trimmed.indexOf('/');
  return idx > 0 && idx < trimmed.length - 1;
}

export function parseTypedModelsFromConfig(raw: unknown): AgentTypedModelRow[] {
  const rows =
    raw && typeof raw === 'object' && !Array.isArray(raw) && 'roles' in raw
      ? Object.entries((raw as { roles?: Record<string, unknown> }).roles ?? {}).map(([id, role]) => ({
          id,
          ...(role && typeof role === 'object' && !Array.isArray(role) ? role : {}),
        }))
      : raw;
  if (!Array.isArray(rows)) return [];
  const out: AgentTypedModelRow[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const model = typeof o.model === 'string' ? o.model.trim() : '';
    if (!id || !model) continue;
    const description = typeof o.description === 'string' ? o.description.trim() : '';
    out.push({ id, model, description });
  }
  return out;
}

export function cleanTypedModelsForPatch(
  rows: AgentTypedModelRow[],
): { roles: Record<string, { description?: string; model: string }> } | null {
  const byId = new Map<string, { description?: string; model: string }>();
  for (const row of rows) {
    const id = row.id.trim();
    const model = row.model.trim();
    if (!id || !TYPED_MODEL_ID_RE.test(id) || !model || !isValidProviderModelRef(model)) continue;
    const description = row.description.trim();
    byId.set(id, description ? { description, model } : { model });
  }
  if (byId.size === 0) return null;
  return { roles: Object.fromEntries(byId.entries()) };
}

export function validateTypedModelsForSave(
  rows: AgentTypedModelRow[],
  messages: { invalidId: string; duplicateId: string; invalidModel: string },
): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.id.trim();
    const model = row.model.trim();
    if (!id && !model && !row.description.trim()) continue;
    if (!id || !TYPED_MODEL_ID_RE.test(id)) return messages.invalidId;
    if (seen.has(id)) return messages.duplicateId;
    seen.add(id);
    if (!model || !isValidProviderModelRef(model)) return messages.invalidModel;
  }
  return null;
}

export function formatTypedModelsSummary(
  rows: Array<{ id: string; model: string; description?: string }>,
): string {
  if (rows.length === 0) return '—';
  return rows.map((r) => `${r.id} → ${r.model}`).join(', ');
}

export function typedModelsRowsFromList(
  entry: Array<{ id: string; model: string; description?: string }> | undefined,
): AgentTypedModelRow[] {
  return (entry ?? []).map((r) => ({
    id: r.id,
    model: r.model,
    description: r.description?.trim() ?? '',
  }));
}
