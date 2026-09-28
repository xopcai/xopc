# Change request — round 1

## Request

Deeply review and align the bottom primary tabs and Chat Input interaction with the recent HarmonyOS implementation.

## Acceptance criteria

- Android and iOS expose the same five primary destinations as HarmonyOS: Assistant, Chats, Progress, Library, and You.
- Every non-Assistant primary tab uses the same Chat Input behavior, attachment picker, reference picker, voice entry, and action panel as Assistant.
- Opening the action panel hides the tab dock on every primary tab; switching tabs closes transient input UI.
- Sending from another tab returns to Assistant and transfers text, attachments, and references atomically without duplicate sends.
- Opening a conversation from Chats returns to the root Assistant experience instead of a standalone screen without the bottom dock.

## Verification constraint

Physical-device deployment requires a connected Android, iOS, or HarmonyOS device. At the time of this round, ADB, CoreDevice, and HDC all report no connected physical device, so native builds and simulator validation are used until hardware is available.
