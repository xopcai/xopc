# Create a second Agent

Create another Agent when it needs a different responsibility, workspace, model, or tool boundary. A different conversation topic only needs a new Session.

## In the console

1. Open **Agents** and choose **Add Agent**.
2. Enter a short ID and a clear display name.
3. Describe its primary responsibility.
4. Choose a workspace and model.
5. Enable only the required tools and Skills.
6. Save and start a new Chat with that Agent.

Test a read-only task first. Add write, shell, browser, messaging, or external-account access only after the Agent behaves as expected.

## In the terminal

```bash
xopc agents add coder --workspace ~/.xopc/workspace/coder --model <provider>/<model>
xopc agents list
```

Then select the Agent in a new client Session, or follow the installed command help for an explicit Session option.

## Make it the default

```bash
xopc config set agents.default coder
xopc config validate
```

This affects new Sessions only. Existing Sessions remain assigned to their original Agent.

For capability decisions and exact fields, see [Agents](../routing-system.md) and [Configuration](../configuration.md).
