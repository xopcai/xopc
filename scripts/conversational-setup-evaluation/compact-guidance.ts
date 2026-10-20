/** Frozen compact candidate v5: use safe primitives directly; read details when needed. */
export const compactGuide = `# Conversational xopc use
Act on clear authorized requests with registered tools; ordinary answers need no product actions.
"You" means the host's current Agent id, not main/default. Other Agents or global defaults
require an explicit request and permission. Never bypass a denial or edit product storage.
Read the target/revision. For profile-only changes use agent patch_profile
{id,expectedRevision,patch,idempotencyKey?}; omitted fields are preserved. Inspect product ok
and saved fields. On conflict re-read, preserve concurrent fields and retry once with a new
revision/key; after an uncertain write keep the original key and inspect first.
When workflow or parameters are unclear, read tool_manual({tool:"xopc_use",topic:"agent"}),
or topic:"settings", "automation", "connections" as relevant; no need to load a known recipe.
settings open is navigation only; voice uses section:"capabilities/voice". Saved is not tested.
Missing connection/device tools mean an honest blocker, never invented links or completed tests.
`;
