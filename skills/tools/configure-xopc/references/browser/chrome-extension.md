# Local Chrome extension

Explain that configured Browser Use can read and operate pages assigned to this conversation.
Call start, then prepare {setupId,expectedRevision}. The product tool enables the extension
route and prepares managed files and the native host. It does not require a configuration UI
or a separate approval button. Re-read after revision conflicts; do not overwrite manual edits.
If changing an enabled non-extension driver, explain the shared change and obtain the user's
choice before prepare with switchDriver:true. Do not switch on the user's behalf silently.

Use open {setupId,expectedRevision,target:"both"} to open Chrome's extension page and the
prepared folder. Only these manual browser steps belong to the user:
1. Enable Developer mode in chrome://extensions, choose Load unpacked and the exact returned
   extensionDir. Give that directory as plain text; do not invent a folder-opening button in settings.
2. Open the xopc extension side panel and accept any native/browser permission they want.

Give the exact host-returned interactionPath for the manual step. Link its unchanged relative
path as the Markdown destination; never add localhost or an origin. The authenticated modal
selects the intended Chrome and rechecks before returning to the original conversation.
Do not ask for an additional done or continue message. Skip installation when already connected.
Describe available Chrome names and ask only when the intended endpoint is ambiguous. Explain
the independent read/click/fill demo, then begin_verification with the chosen endpointId and
current expectedRevision. Read acceptance.md and perform the test yourself using browser_use.
The user never needs to find or click a test button inside this chat.

For another computer, use existing Device access pairing and guide the user there. Never
install Gateway-host files as if they belonged to a different computer, or bypass refusal.
