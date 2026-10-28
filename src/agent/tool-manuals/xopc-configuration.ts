/** Focused product workflows; loaded on demand instead of expanding every turn. */
export const xopcConfigurationTopics = {
  mcp: `# HTTP MCP configuration
In Weixin do not inspect the global registry. The host chooses a stable connection id from
the exact service and private identity; use the returned serverId, and displayName for human
labels. Different service URLs never overwrite a connection because a model reused a name.
A paired Weixin direct conversation can propose a new connection when the host has a secure
gateway.publicUrl. Its returned absolute interactionPath requires authenticated owner approval
of the exact service and Weixin identity, then secure Token/OAuth input. Send that exact link
and stop; never ask for a secret, callback URL or continue reply in Weixin. The host resumes
and delivers the actual result to the same original account/peer after authorization.
Pairing is not owner authority; no replacing/removing shared connections through this proposal.
Missing pairing, HTTPS access or login is an honest blocker. Do not bypass it with local tools.
When registered use mcp_setup; otherwise use xopc_use mode mcp_setup, the equivalent adapter.
Probes run on the Gateway host, including user-provided HTTP loopback addresses. Never infer
reachability from the browser/device context; use the actual probe and report its result.
inspect {} returns configured server IDs and revisions without
secrets. For a clear connection request start {serverId,url,purpose,displayName?,expectedRevision?}.
Use displayName for the user's service name. Derive a simple ASCII serverId when none was
supplied; do not ask users to invent technical identifiers. Use only the user-supplied or
verified service URL, never invent one. start is HTTP-only and does
not execute package installers. purpose preserves the original user objective. Replacing a
configured server requires its revision from inspect. Do not alter managed connectors/plugins.
Then advance {setupId,expectedVersion} using the returned version. get {setupId} refreshes
status; cancel requires the current version. OAuth/Token steps provide interactionPath:
link to that trusted product page, never request credentials or OAuth callbacks in chat.
Use the exact returned interactionPath in a Markdown link; Weixin paths are absolute. do not invent a URL
scheme or setup id. The host also displays a trusted Complete connection action above input.
The page owns sign-in, safe credential entry, verification and automatic return to the
original objective. When ready/continuationQueued is returned, stop this turn; the host
continues in a fresh turn where native MCP tools can load. Use native tool_search and the
discovered exact tools for the original read; do not invent a tool name or claim a read from
tool counts. set_enabled {serverId,enabled,expectedRevision} and remove {serverId,expectedRevision}
change local custom-server configuration. Removal does not revoke remote OAuth authorization
or uninstall a package. A clear request to connect, disable, enable or remove a specific local
connection already authorizes that operation; do not ask for the same confirmation again.
New overwrite scope or additional privileges still require authorization. Respect permission refusals and report blocked/reload_required states.
For an already configured healthy service prefer its actual tools over replacing its setup.`,
  skills: `# Skill configuration
Use skill_manage status to inspect installed skills, including disabled ones and current Agent
availability. skills_list contains only usable skills. Search with skills_marketplace_search;
recommendation alone never authorizes installation. Install an exact returned reference with
skill_install only for a clear installation request. Default target is global; explain that
scope, and use workspace when explicitly requested. Do not force-overwrite an existing skill
without an explicit update/replace request. After an uncertain install inspect status and the
existing source before retrying; do not blindly reinstall. Enable/disable with skill_manage;
these flags are shared by name, not per-Agent permissions. Inspect the resulting state; do
not widen an allowlist, install dependencies through shell or ask for secrets in chat.
Delete/uninstall with skill_manage delete only for writable managed user skills; bundled,
plugin-owned and extra-directory skills must retain their owner management path. After
installation, read skill_view and complete the user's requested first task. Return an actual
result, two relevant example requests and the installed-skills link. A ready state is not a
successful task test. Never claim success when requirements or Agent policy still block use.`,
  agent: `# xopc Agent configuration
The host's current Agent id is authoritative. "You / this assistant" means that Agent,
not main or the default Agent. Read agent get {id} (or list for discovery) for revision
and effective inherited configuration. For identity changes prefer agent patch_profile
{id,expectedRevision,patch:{name?,description?,style?,language?,...},idempotencyKey?}:
omitted fields are preserved atomically. Existing agent update {id,expectedRevision,patch}
remains a full replacement for patch.profile, so include every field to retain when using it.
Set a chat model with update patch.models.chat={primary:"provider/model",fallbacks:[]}.
Change only the requested Agent. Global defaults and other Agents are separate explicit
requests and still require permission. For creation list first, then create
{id,profile:{name,language?,style?}}; do not invent a Project or custom workspace.
set_default {id,expectedRevision} uses the catalog revision from list, not an Agent revision.
After a revision conflict re-read the target, preserve concurrent fields and retry the
requested change once with the new revision and a new intent key. After an uncertain write,
inspect first and retain the original idempotency key. A permission denial is not a conflict:
do not switch identity, target or tools to bypass it. Inspect returned product ok and saved
fields before reporting success. A saved model reference does not prove it can be called.`,
  phone_setup: `# Phone setup
Use configure-xopc and references/phone/overview.md. Use plain conversation, never embedded chat
configuration panels. mode phone_setup inspect/preview/start inspect or resume; models lists
compatible models. get/recheck/verification_report/cancel/release take {setupId}.
Automate source {setupId,source:local|aliyun,expectedRevision}, configure {setupId,enabled:true,
expectedRevision}, install_dependency {setupId,kind:adb|scrcpy,repair?:true,expectedRevision},
set_model {setupId,modelRef:<listed compatible ref>,expectedRevision,replaceExisting?:true},
register_local {setupId,serial:<discovered online serial>,name?,expectedRevision}, and
begin_verification {setupId,deviceId,expectedRevision}. Writes require a host-authorized
interactive turn and preserve current policy. dryRun never writes. Do not silently select a
phone, change the chat model, widen app access, use shell installs or submit keys in chat.
Use set_model for the dedicated Phone model only; it cannot change the chat model; credentials use secure settings.
Explain the Settings-only goal, screenshot sharing and model costs before testing. Get provides
attempt.goal/completion/maxActions. Use phone_use open, observe, run, close, then verification_report.
User-only work is physical USB/RSA, login/OAuth, private-key entry/upload and cloud purchase.
After interruption recheck, release the old test, resolve the cause and continue here.`,
  browser_setup: `# Browser setup
Use configure-xopc and its Browser references. Plain conversation only; no configuration panel
inside chat. mode browser_setup inspect/preview/start inspect or resume. get/recheck/
verification_report/cancel/release take {setupId}. prepare/advance {setupId,expectedRevision}
automatically prepares the managed extension/native host and enables the extension route in
an authorized interactive turn. Explain and confirm a shared driver change before switchDriver:true.
open {setupId,target:chrome|folder|both,expectedRevision} opens the existing Chrome page/folder.
Only the user loads the unpacked extension and accepts native permissions. Recheck connection,
resolve the intended Chrome with the user, explain the bounded read/click/fill demo, then use
begin_verification {setupId,endpointId,expectedRevision}. The host derives the fixture origin.
Use normal browser_use calls on the returned attempt; close and read verification_report.
No API Key is needed. Preserve policy refusals and existing pairing; only manual steps need
an ordinary link to settingsPath. dryRun never writes; opening a page is not proof of success.`,
  settings: `# xopc settings and capability checks
settings open is navigation only; it does not read, apply or verify configuration.
Voice: {section:"capabilities/voice",title:"语音设置"}; models: section:"capabilities/models";
browser: section:"agent-browser". Unknown sections are rejected. There is no generic
config/set, capability inspect or voice mutation in xopc_use. Never edit storage directly.
For a capability report read the current Agent's configuration, and use actual dedicated
status/test tools if available. Model names or credentials alone are not proof of readiness.
Report unknown when no verification tool exists. Saved, runtime-ready and tested differ.
Voice settings are shared. Microphone permission, recording and playback need actual device
interaction. Return the exact product link and state the remaining action; never claim the
page has opened or the device test passed from a navigation receipt. Do not invent UI buttons
or promise audio verification unless the active tools can perform it.`,
  automation: `# xopc automations
In a paired Weixin conversation the host pins result delivery to that exact original account
and peer. Use notificationPolicy:all for requested reminders; do not invent a Weixin webhook,
recipient or client API. The normal saved run and durable delivery receipts remain separate.
Use automation list/get before changing an existing schedule or creating a potentially
duplicate one. pause/resume takes {automationId,expectedRevision,idempotencyKey}; revision
is the original updatedAtMs. Pause affects future scheduling, not proof a running job stopped.
Create with {name,enabled,trigger:{kind:"schedule",schedule:{kind:"cron",expr,tz}},
action:{kind:"agent",instruction},delivery:{notificationPolicy:"all",destinations:[{key:"gateway_event",kind:"gateway_event"}]}}.
For a reminder/report whose result the user expects, notify on success with notificationPolicy:all.
attention is for exceptional/needs-action updates; none is for an explicitly silent task.
Use the user's timezone. For 09:00 Asia/Shanghai use expr:"0 9 * * *",tz:"Asia/Shanghai".
One-time reminders use trigger:{kind:"schedule",schedule:{kind:"once",afterMs:90000}} for
90 seconds after acceptance, or schedule:{kind:"once",at:<future ISO timestamp>}. The server
anchors afterMs once within the stable receipt. Never encode a one-time reminder as cron:
date fields still repeat every year. Preserve the saved once/at when inspecting the result.
Draft / don't enable / don't run means enabled:false and no run call. simulate is not a real
execution. For an explicitly requested trial, run the same saved disabled object, then read
get_run {runId,waitMs:30000} until terminal or a real blocker. Queued/running is not completion.
Report the actual result. When the user requested trial-before-enable, enable that same object
only after a successful run; never enable after failure or replace it with a duplicate.
For a custom HTTP MCP read, first verify a real read from the selected service. Then use
automation prepare_source {serverId,toolNames:[exact discovered tool names]} (or automation
action prepare_source) to pin its server/grant reference and read-only tool contracts.
Use optional toolInputs:{<exact tool name>:<fixed argument object>} for the verified read's
arguments; omitted inputs mean {}. Calls must retain these inputs, so account/query parameters
cannot silently change on later runs. Dynamic parameter scopes require a dedicated adapter.
Create the disabled agent action with mcpSourceId:<returned sourceId>, agentId:<returned agentId>.
Every run is restricted to these tools and must actually read successfully. A changed or
disabled source fails, without switching services. Enabling requires a successful trial of
that exact action on the same object. Ordinary self-contained reminders need no MCP source.
Use conversationMode:continuous when the user asks to retain task context between runs;
historical context never replaces a fresh source read in the current run.
When changing a bound action or assistant, save it paused, trial the updated action, then enable
if authorized. Schedule-only edits retain the verified action. Existing source pins are retained
when an agent action is replaced; omitting mcpSourceId cannot silently remove the boundary.
This generic source binding does not verify remote account identity. Explicit-account workflows
remain disabled unless their account adapter verifies identity; never invent that verification.
A clear create/change/pause/resume/delete request already authorizes that local operation;
do not repeat confirmation. A one-off answer does not authorize creating a Task, Project, Agent or Automation.
Check returned ok and saved state; handle revision conflicts by re-reading, preserving changes
and retrying once with the new revision. Keep original keys after uncertain writes.`,
  connections: `# xopc external connections
For a user-supplied HTTP MCP address, use the mcp manual topic and registered xopc_use
mcp_setup commands. These configure a custom server; they are separate from connector discovery.
External services use their dedicated discovery, description, connection and execution tools,
not invented xopc_use connector commands or settings sections. When Gmail connection/read
tools are absent, explain that specific blocker. Do not create or enable an email schedule
before verifying the required account and a real read. Never invent a connection URL,
connected-apps/connections settings section, messages, or successful OAuth/reads.
The user saying "connected" is not evidence of working tools: rediscover and verify the
account and read permission before proceeding. Do not promise future execution while those
tools are absent. Do not request passwords or API keys in ordinary chat.`,
} as const;

export type XopcConfigurationTopic = keyof typeof xopcConfigurationTopics;
