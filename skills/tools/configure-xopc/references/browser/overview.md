# Browser setup

Read tool_manual({tool:"xopc_use",topic:"browser_setup"}); if tool_search is available, discover
the exact xopc_use tool before its first invocation. Then call
xopc_use({mode:"browser_setup",command:"inspect"}). Configuration is shared across the Gateway;
actual browser actions still obey the current Agent's tool and action policy.

After inspect selects the extension route, read chrome-extension.md before start or explaining
installation steps. For the user's current Chrome this is the supported branch. Other modes remain in Settings → Browser;
remote Chrome pairing is in Device access. Do not install Gateway-host files as though they were
on another computer. Use existing connections when appropriate; never switch a working driver
without explaining the shared impact.

start {} creates/reuses a setup tied to this conversation and Agent. Its settingsPath opens the
owner setup panel, also shown in chat. Owner approval permits preparing files and enabling the
extension configuration. If tools are unavailable, provide the returned settings entry and the
remaining action rather than shell/file fallbacks. No arbitrary config paths are accepted.

For repair requests, inspect installation health even when an earlier run completed. Load
troubleshooting.md on missing files, denied toolPermission or interrupted verification. Reuse
the saved run while unfinished; a completed run can be followed by a new repair plan in the
same conversation. Never reuse successful evidence for a new verification attempt.
