# CLI commands

Run `xopc` with no command to open the terminal interface. Use subcommands for setup, scripting, maintenance, and diagnosis.

## Basics

```bash
xopc --help
xopc <command> --help
xopc --version
```

Global options such as `--config <path>` and `--workspace <path>` select a different configuration or workspace for that invocation. Prefer [profiles](#profiles-and-paths) when you need a reusable isolated setup.

## Command overview

| Command | Description |
| --- | --- |
| `init` | Initialize state, configuration, and the Agent workspace |
| `setup` | Create the base configuration and workspace |
| `profile` | Manage separate xopc state profiles |
| `onboard` | Run the guided first-time setup |
| `channels` | Configure messaging channels and pairing |
| `auth` | Manage authentication credentials |
| `agent` | Send one message or start interactive Agent chat |
| `tui` | Open the full-screen terminal interface |
| `resume` | Resume a previous TUI Session |
| `tunnel` | Manage public tunnel access |
| `gateway` | Run and manage the Gateway |
| `session` | List and manage Sessions |
| `project` | Manage long-running Projects |
| `doctor` | Diagnose installation, data, and security issues |
| `runtime` | Manage Node.js and Python tool runtimes |
| `update` | Check for and install updates |
| `logs` | Query and follow logs |
| `config` | Read, edit, and validate configuration |
| `image` | Inspect image provider availability |
| `models` | List models and choose defaults |
| `providers` | Manage provider credentials |
| `voice` | Configure text-to-speech output |
| `search` | Configure web-search providers |
| `skills` | Install, configure, audit, and test Skills |
| `connectors` | Browse and install connector capabilities |
| `tailscale` | Inspect Tailscale access status |
| `browser` | Manage browser automations and dependencies |
| `agents` | Create, list, and remove Agents |
| `extensions` | Install and manage extensions |

This table follows the current top-level `xopc --help`. Run the command's own `--help` for available options and examples.

## Common tasks

```bash
# First setup
xopc onboard --quick

# Start or send Chat
xopc
xopc agent -m "Summarize this folder"

# Model status
xopc providers list
xopc models status

# Gateway
xopc gateway
xopc gateway health

# Configuration and diagnostics
xopc config validate
xopc doctor
xopc logs tail
```

## Profiles and paths

Profiles keep separate state, Agents, credentials, and Sessions for different contexts. Run `xopc profile --help` to create or select one. Always confirm the active paths when a command appears to use different data:

```bash
xopc profile list
xopc config path
```

## Script-friendly output

Commands that support `--json` should be preferred in scripts. Check exit status, avoid parsing human tables, and never print unmasked credentials. Use `--help` on the exact command to confirm its JSON support.

## Safety

- Read confirmation prompts before deletion, cleanup, token rotation, or update actions.
- Avoid passing secrets directly on the command line on shared systems.
- Verify the current profile, Agent, workspace, and Gateway before commands with external side effects.
- Use `--help` from the installed version; online documentation may describe a newer release.
