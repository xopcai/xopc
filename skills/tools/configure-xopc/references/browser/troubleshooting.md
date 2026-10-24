# Browser setup recovery

- Existing installation repair: inspect installation health and toolPermission, even if an older
  setup completed. If files need repair, start a new reviewed setup in this conversation;
  keep the existing endpoint and pairing identity. Never reinstall or re-pair a healthy connection.
- Files missing or INSTALLATION_REQUIRED: use the panel's preparation action after owner approval.
- Files prepared but no endpoint: guide Chrome loading and opening its side panel, then recheck.
- Old extension: reload xopc in chrome://extensions, open the side panel and recheck.
- LOCAL_OWNER_REQUIRED: open setup on the Gateway computer; use Device access for remote pairing.
- Multiple endpoints: let the owner select the correct Chrome in the panel.
- CONFIG_CHANGED: preserve the latest manual configuration and start a reviewed replacement plan.
- TAB_ALREADY_ATTACHED: ask the user to release the current tab before the independent demo.
- Verification stopped, timeout, action failure or target changed: close the verification session
  through browser_use first. Inspect evidence; do not repeat unknown writes or claim release.
- Agent browser_use missing/denied: do not repeatedly search for a tool inspect marks denied.
  Explain the owner can keep it denied, or change the Agent tool permission and return to this
  same conversation. Do not alter that permission yourself. Re-inspect after the owner acts.
- Agent browser_use missing/denied: connection does not grant tool permission. Use the Agent
  settings and continue in a refreshed run once the authorized tool is available.

Do not use a different identity, endpoint, file edit or shell command to bypass a refusal.

- Chrome stop, BROWSER_CONTROL_REVOKED, or local host blocked: read
  permissions.md before guiding recovery. Do not reattach or ask for unrelated OS permissions.
