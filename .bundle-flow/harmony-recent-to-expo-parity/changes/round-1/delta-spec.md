# Delta specification — bottom tabs and Chat Input

## Navigation model

The Expo client uses a five-item primary tab model matching HarmonyOS. Chats is a first-class tab rather than a pushed standalone page.

## Composer model

One shared composer implementation owns draft text, attachment selection, image previews, references, voice entry, and the action panel. Non-Assistant tabs host a lightweight instance of that composer above the same capsule tab dock.

## Handoff contract

When a non-Assistant composer submits, it creates/selects the destination conversation, stores a single atomic handoff payload, dismisses to the root Assistant route, and auto-sends only after the root composer is ready. The payload includes text, wire attachments, context references, voice mode, and the auto-send flag. Failed or refused sends restore the payload into the root composer.

## Transient-state rules

- Opening the action panel closes the keyboard and hides the tab dock.
- Switching primary tabs closes the action panel.
- Keyboard and action panel never compete for the same bottom accessory space.
- Selecting a conversation from Chats dismisses to the root Assistant route and preserves the primary navigation shell.
