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
  const guide = `${manualGuide}\nxopc_use is registered and may be deferred. If its schema is absent and tool_search is available, discover the exact name before reporting it missing. Never bypass policy.\n${toolNames.includes('mcp_setup') ? 'For a task on a specific service, carry forward its service, account and objective from the conversation when the user asks to proceed. Search existing tools and connectors, then judge relevance to the exact service and operation. Unrelated results count as no match. For account data or service actions without a usable tool, call mcp_setup discover with the exact service name and original objective before browser or device calls. Use managed matches first. For relevant documented references, propose and start the best supported plan for host review, then let the app handle authorization. If discovery finds no usable route, or the user declines it, use an authorized same-scope browser route when available. For an account page that needs interaction, search for the exact tool name browser_use if it is deferred, then call browser_use directly. Use its actual result to determine readiness. Browser setup describes setup options; it does not establish that a configured browser is unusable. If there is no verified portal URL or suitable open page after discovery, ask for the account URL and end the turn. Discovery errors are not confirmed absence. Public information and explicit browser requests may use the requested web route directly. Read manual topic mcp for public discovery; do not guess an endpoint. Explicit loopback addresses remain supported. Use connect_only for connection alone; otherwise preserve the original task. When setup returns interaction=chat_card, tell the user what the app action is for and stop without a link. For link-only channels use the returned interaction path. Keep secrets out of chat; authentication uncertainty is not proof of Token or OAuth.\n' : ''}`;
  const browserGuide = toolNames.includes('browser_use')
    ? '\nFor web account tasks, browser_use owns navigation, reading and verification. Keep the task in that browser session. Treat a visible field’s label and value in a browser observation as page evidence, including values represented as textboxes. If the expected account page supplies the requested value and its unit or status, answer with what the page reports and stop. An unusual value or display format alone does not justify assuming another unit, opening other pages, or consulting the shell. If a required detail is missing, re-observe in Browser Use when that can resolve it; otherwise report the specific gap. Shell and raw HTTP are for separate tasks, not reading or cross-checking the account portal.\n'
    : '';
  return toolNames.includes('skill_manage')
    ? `${guide}${browserGuide}\nFor Skill configuration use skill_manage status/enable/disable/delete and skill_install; never edit product storage through shell/file tools. A clear request to install a specified source already authorizes that installation: do not ask for the same confirmation again. Search or a pasted URL alone does not authorize installation; overwrites or additional permissions require their own authorization. Load the skills manual topic when needed. Installation is not a verified first use. For an explicit HTTP MCP service address, use xopc_use mode mcp_setup and manual topic mcp; credentials use its trusted interaction page.\n`
    : guide + browserGuide;
}
