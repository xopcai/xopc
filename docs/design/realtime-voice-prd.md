# Persistent voice conversation PRD

Updated: 2026-09-05. Scope: xopc gateway console and Electron renderer.

## Product contract

One Chat Session owns the conversation. Text, voice calls, hangups and reconnects share its history. A call is an interaction inside that Chat, not a new Chat. Only explicit new-chat/reset actions start a new conversation.

| Action | Experience | Context and capabilities |
| --- | --- | --- |
| Dictation | Microphone → editable text in the composer | No automatic submission |
| Voice assistant | Continuous speech with the current Agent | Existing tools, approvals and Chat history |
| Natural conversation | Native audio replies, without tools | Configured Agent name/instructions and bounded history from the same Chat |

## User journey

1. Click the call action in Chat. A project preparation screen creates its initial Chat once if needed.
2. Choose Voice assistant or Natural conversation in the call window. This mode remains selected during the current app session.
3. Start the call. Validate capabilities, then request microphone permission. If services are missing, configure XOPC hosted voice or one shared DashScope credential in the call window or Settings.
4. Talk naturally. See listening/thinking/speaking state and optional current-turn captions. Interrupt the reply when necessary.
5. Mute the microphone to stop captured-audio upload while continuing to hear the assistant. Minimize the call to navigate other pages. Closing the expanded panel minimizes it; the separate End action terminates it.
6. Hang up. Final transcript writes complete before the server releases the Chat reservation. Text conversation can then continue with the same history.
7. Start another call from the Chat call button. Reuse the same Chat; restore the bounded model context for a new native connection.

The composer call button is the single entry point. Connection timestamps and durations are not shown as a separate list; conversation content remains in Chat.

## Configuration

The default service choice configures dictation, Agent speech and native audio together. Ordinary message readout remains independent. Natural audio shares the input credential by default. Independent native endpoint, key, voice and instructions remain intentional advanced options. Re-enabling the same service preserves explicit settings; changing services discards incompatible native route overrides.

The native model is `qwen3-omni-flash-realtime`. Hosted voice requires a signed-in XOPC account and published platform routes. Capability preflight validates local configuration and Chat availability; live connection failures remain possible. Settings diagnostics test actual speech routes separately.

## State and limits

- One capture owner per renderer prevents dictation and calls from competing for the microphone.
- One call reservation per Chat prevents concurrent text runs, edit/reset/delete operations and other calls from changing its context.
- Route navigation/minimization preserves capture. Renderer reload, account/gateway change, device failure, network loss or time limit ends the call connection.
- Disconnection leaves the Chat and its saved history intact. Reconnect is explicit; no automatic microphone reopening or indefinite provider socket is promised.
- Mode changes take effect on the next call. There is no automatic engine fallback.
- The model sees bounded context. Earlier excerpts may omit details; full persisted history remains available to the user.
- Interrupted generated speech may contain unheard words. Subsequent model context includes an interruption marker instead of treating the generated reply as fully heard.
- Raw audio and partial transcripts are not stored by this feature. Final native speech uses the existing SQLite transcript.

## Acceptance

Verify text → call → text → call on the same key, both call modes, minimize/navigation, actual input mute, end/reconnect, missing configuration, denied microphone permission, late asynchronous capture completion, transcript refresh and reset/deletion fencing. Automated checks use synthetic audio or mocked providers; physical-device and paid-provider acceptance are separate from those checks.
