# Personal AI follow-ups

Personal AI can keep track of a topic you ask it to follow and leave a useful update in your personal conversation. Being inactive alone does not trigger greetings or reminders.

## Ask for a follow-up

In your Personal AI conversation, try:

```text
Check this direction again tomorrow afternoon. If you have a useful suggestion,
tell me here. Keep the follow-up within the sources I have already authorized.
```

Wait for the assistant to confirm the saved follow-up and actual check time. “Tomorrow afternoon” is interpreted as 15:00 in the proactive-message timezone. A check time is not a guaranteed delivery time: preparation and queues can delay it, and there may be no message when nothing useful has changed. Use an [Automation](./automations.md) for a fixed scheduled reminder.

## Control when it contacts you

Open Personal AI's preferences and find **Proactive messages**:

| Mode | Behavior |
| --- | --- |
| Off | Disables proactive contact; results from existing explicit requests can still be delivered |
| Explicit follow-ups only | Follows the topics you deliberately delegate |
| Thoughtful participation | Also considers sufficiently supported discussion context |

The default is thoughtful participation, with quiet hours from 22:00 to 08:00. Review the timezone and quiet hours, especially when your Gateway runs on another machine.

Your current conversation takes priority. Proactive updates wait while you are speaking, have input queued, or are awaiting an explicitly requested result.

## Review and change a topic

Open the small explanation below a proactive message to see why the assistant followed the topic and why it contacted you now. Inferred attention is labeled; it does not mean you authorized work or external actions.

You can delay or stop the topic, ask for more complete preparation or shorter updates, and undo the latest topic adjustment. These choices apply to that topic, rather than changing every conversation. A stopped topic requires an explicit request to resume. Expired or inaccessible sources cannot be restarted through undo.

You can also ask in chat: “Stop following this topic” or “Prepare a complete answer before contacting me about this again.” Name the topic when several discussions are active.

## Runtime and privacy

- Keep the local Gateway running and configure a working model. Due items are checked roughly once a minute; this is not a delivery guarantee.
- After an offline period, checks are combined rather than sending a backlog of outdated messages.
- User-understanding, session-access and write policies still apply. Background model preparation is paused under the local-only understanding policy in the current release.
- Updates are delivered in the Personal AI conversation. External channel notifications are not enabled by this feature.
- You can ask what long-term interests the assistant has inferred. Interest candidates remain silent and do not automatically start follow-ups.
- Deleting or revoking a source prevents further disclosure of that evidence; it does not erase message text already delivered.

If nothing arrives, check the selected mode, quiet hours, timezone, model availability and Gateway connection. Ask the assistant to show the saved topic before creating another follow-up.

See [Understanding and memory](./user-understanding.md) for correction and deletion, and [Projects, Tasks, and Notes](./projects-tasks-notes.md) for work with a verifiable result.
