# Tools

Tools let an Agent do more than produce text: read files, search the web, run commands, use memory, operate a browser, create media, or start other xopc features. Each Agent should receive only the tools needed for its job.

## Common tool groups

| Group | Typical use | Main risk |
| --- | --- | --- |
| Files | Read, create, and edit workspace files | Unwanted file changes |
| Shell | Run local commands | Code execution and data loss |
| Web | Search and retrieve public pages | Sending queries to external services |
| Browser | Interact with websites | Acting in signed-in accounts |
| Memory | Find user-owned context and past information | Revealing private context to a model |
| Messaging and media | Send messages, files, speech, or images | External side effects and cost |
| Automation and workflows | Start repeatable or scheduled work | Unattended actions |
| Delegation or code runtime | Split work or execute generated code | Broader compute and access |

Actual availability depends on the installation, Agent policy, credentials, and optional dependencies.

## Enable tools for an Agent

1. Open **Agents** and select an Agent.
2. Open its **Tools** or capability section.
3. Enable the smallest group that completes the task.
4. Save and start a new test Session.
5. Ask for a read-only action first, then verify any write or external action.

If a tool is installed but not available, the Agent policy may deny it. If the Agent can see it but execution fails, check its provider, runtime, or credential.

## Safe defaults

- Keep shell, browser, message sending, and destructive file actions disabled unless needed.
- Restrict file tools to the intended workspace.
- Require confirmation before irreversible or externally visible actions.
- Use a separate Agent for high-trust capabilities rather than enabling everything on the default Agent.
- Review unattended Workflow and Automation tool access separately.

## Optional setup

Some tools need more preparation:

- Web search needs a configured search provider.
- Browser automation needs a supported browser runtime.
- Image generation, voice, and transcription need compatible providers.
- Local code execution may need the [tool runtime](./runtime-tools.md).
- MCP tools need an active [MCP server](./mcp.md).
- Extension tools need an enabled [extension](./extensions.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Agent says a tool does not exist | The tool is installed and allowed for that Agent |
| Tool asks for a missing credential | Configure the provider or connector shown in the error |
| File tool cannot access a path | The path is inside the Agent workspace and permissions allow it |
| Browser tool fails on first use | Install the required browser runtime and confirm the Agent permits browser use |
| Tool works in one Agent only | Compare the two Agents' capability policies |

Inspect **Settings → Logs** or run `xopc logs tail` after one failed call. The first tool error usually identifies the missing permission, dependency, or credential.
