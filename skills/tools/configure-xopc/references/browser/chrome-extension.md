# Local Chrome extension

Explain: after setup, xopc can read and interact with pages assigned to the conversation.
Call browser_setup start, then present the setup panel. It handles local-owner approval,
shared-driver changes, file preparation, and opening Chrome's extension page and folder. Present the returned settingsPath exactly
when a settings link is needed; do not replace it with a generic settings open call, which
loses this setup's identity. Prefer the existing configuration panel in the conversation.
advance {setupId} can prepare only after product-owner approval; get reads saved progress.

Files prepared does not mean Chrome has loaded the extension. Guide the user through:
1. Open chrome://extensions and enable Developer mode.
2. Choose Load unpacked and select the prepared directory itself.
3. Open the xopc extension side panel so it connects to the local Gateway.

Use recheck after user actions. A connected endpoint must be selected by the owner in the
setup panel before starting the test. Do not choose the first connected computer implicitly.
The test creates its own browser session; an attached user tab must be released first.
Read acceptance.md before operating. If a user is on another computer, direct them to Device
access's pairing flow; local installation controls must not bypass local-owner restrictions.
