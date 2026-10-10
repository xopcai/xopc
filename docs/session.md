# Chat and sessions

A Session is one saved conversation with an Agent. It keeps the messages and working context needed to continue later from desktop, browser, terminal, mobile, or a connected channel.

## Start a conversation

- In the desktop or web console, open **Chat** and choose **New chat**.
- In the terminal, run `xopc` for the TUI or `xopc agent -i` for interactive CLI chat.
- For one message, run `xopc agent -m "Your request"`.

Start a new Session when the goal or audience changes. Continue the existing Session when you want the Agent to use the current conversation context.

## Find and resume a Session

The console sidebar lists recent conversations. Select one to continue it.

In a terminal:

```bash
xopc session list
xopc resume
xopc resume <session-key>
```

Use `xopc session info <session-key>` when you need details about a specific Session. Run `xopc session --help` for less common management commands.

## Reset or delete

| Action | Use it when | Result |
| --- | --- | --- |
| New chat | You have a different goal | Creates a separate conversation |
| Reset | You want fresh context in the existing conversation | Archives the current transcript, preserving conversation identity and per-session overrides |
| Delete | You no longer want the Session listed or stored | The Session is removed from the index and its data is deleted |

Reset is the safer default. Delete only when you intend to remove the saved conversation.

## Sessions and Agents

Every Session is assigned to one Agent. The Agent determines its role, model choices, tools, skills, and workspace. Changing the default Agent affects new Sessions; it does not silently move existing conversations.

See [Agents](./routing-system.md) to create or select another Agent.

## Keep conversations useful

- Use a short, descriptive title when the client allows it.
- Keep one main goal per Session.
- Start a new Session when old context is likely to confuse the next task.
- Use a Task when work needs an explicit status and next action beyond the conversation.
- Do not paste secrets unless they are required and you trust the configured model provider.

## Storage and privacy

Sessions are stored in the local xopc database under the state directory. If you use a cloud model, the messages sent for a turn are still processed according to that provider's policy.

For backup and deletion locations, see [Data and file locations](./workspace.md).

To publish a reviewed, read-only snapshot of a conversation, see [Share a conversation](./session-sharing.md).

## Troubleshooting

| Problem | Check |
| --- | --- |
| A recent Session is missing | Confirm that the client connects to the same Gateway and state profile |
| Resume opens the wrong Agent | Inspect the Session details and the configured default Agent |
| A long conversation loses older detail | Summarize important facts in the Session or move durable material into a Task, Note, or workspace file |
| Sessions fail to load | Run `xopc doctor --deep`, then inspect `xopc logs tail` |

## Models and project environments

The composer shows the concrete selected model and its supported thinking level. That selection is saved to the conversation; a provider error does not silently switch models. Finish active or queued input before changing the model. If an old selection is unavailable, explicitly choose an available model.

When starting Chat from a Project with a configured workspace, choose **Local** or **New local worktree**. Local means the Gateway's machine. Selecting an option creates no directory; the first send creates the conversation and its execution environment. A new worktree starts at current HEAD and does not copy uncommitted edits.

If creation fails, the draft is retained. Fix the cause or explicitly select another environment before sending again. Existing conversations retain their environment; start another conversation to use a different one.
