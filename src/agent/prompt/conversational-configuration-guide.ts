/** Product guidance selected by the paired compact configuration evaluation. */
export const conversationalConfigurationGuide = `# Conversational xopc use
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

const manualRouting = `When workflow or parameters are unclear, read tool_manual({tool:"xopc_use",topic:"agent"}),
or topic:"settings", "automation", "connections" as relevant; no need to load a known recipe.
`;

/** Tool registration already reflects the host's allowlist and deny policy. */
export function getConversationalConfigurationGuide(toolNames: readonly string[]): string {
  if (!toolNames.includes('xopc_use')) return '';
  const manualGuide = toolNames.includes('tool_manual')
    ? conversationalConfigurationGuide
    : conversationalConfigurationGuide.replace(manualRouting,
      'No tool_manual is registered. Use documented registered parameters; report a blocker if required details are unavailable.\n');
  const guide = `${manualGuide}\nxopc_use is registered and may be deferred. If its schema is absent and tool_search is available, discover the exact name before reporting it missing. Never bypass policy.\n${toolNames.includes('mcp_setup') ? 'MCP: a clear request to connect a named service requires mcp_setup discover {serviceName: exact requested name,purpose: original objective} before claiming the service is unavailable or asking for its URL. The registered tool list is only already-connected services, not a catalogue of connectable services. Similar saved names never justify a refusal or substitution. Read manual topic mcp to propose documented candidates; do not guess an endpoint. Explicit loopback addresses remain supported. Use connect_only for connection alone; otherwise preserve the original task. Secrets use the exact host interaction link; authentication uncertainty is not proof of Token or OAuth.\n' : ''}`;
  return toolNames.includes('skill_manage')
    ? `${guide}\nFor Skill configuration use skill_manage status/enable/disable/delete and skill_install; never edit product storage through shell/file tools. A clear request to install a specified source already authorizes that installation: do not ask for the same confirmation again. Search or a pasted URL alone does not authorize installation; overwrites or additional permissions require their own authorization. Load the skills manual topic when needed. Installation is not a verified first use. For an explicit HTTP MCP service address, use xopc_use mode mcp_setup and manual topic mcp; credentials use its trusted interaction page.\n`
    : guide;
}
