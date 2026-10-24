# Chrome and system permission recovery

Keep the original conversation and inspect the saved setup. Chrome's debugging notification
has a Cancel control: cancelling revokes control across tabs until the user explicitly chooses
Resume browser control in the xopc extension. This stop survives worker restarts. Neither a
model request nor opening a new test tab is consent to resume. Do not repeatedly retry.

After a stop, read setup get and close only its demo session (or use the owner's Release demo
control button). Report release separately. Ask the user to review the extension's stopped
notice and resume only if they want to. Then recheck; the owner starts a new independent test
in the original chat. Old checks must not mark the new test passed. Read acceptance.md and
verify real reading, clicking, typing and release again.

If the native host cannot start, no pairing or browser control is proven. Inspect installation
health; the owner can use Repair preparation to restore xopc's managed executable and manifest,
then Retry local connection in the extension. Preserve an existing pairing if it is healthy.
If an OS or managed-browser security policy blocks execution, explain the observed failure and
let the user review that specific permission through normal settings. Never disable Gatekeeper,
remove quarantine flags, change enterprise policy, or claim a system prompt was accepted.

Local Chrome extension Browser Use uses Chrome's debugger and native messaging. It does not
require macOS Screen Recording, Accessibility, or Apple Events Automation for this route.
Do not instruct users to enable unrelated camera, microphone, location or OS permissions.
If a genuine system security dialog appears, let the user decide; staying denied is supported.
After they return, recheck actual installation/connection; their saying “allowed” is not proof.
