# Import from another AI app

Open **Settings → Import**, find Codex or Claude Code, and click **Import**. xopc detects apps on the device where its Gateway runs. There is no scan wizard, item selection, preview, or separate activation step.

## What comes across

- **Skills:** portable `SKILL.md` directories and their resources. Shared skills already available in xopc are counted as existing.
- **Working context:** user and project `AGENTS.md` / `CLAUDE.md`, plus Claude rules. These become searchable source documents with provenance, rather than replacing xopc instructions or promoting text to confirmed facts about you.
- **Projects:** existing workspace directories recorded in the source app's `projects` configuration. Existing xopc projects are matched by canonical path. Project context remains scoped to that project.

Context uses xopc's existing local-file (`workspace`) knowledge-source policy and session privacy controls. Long documents are split into small reference records for retrieval. Project skills retain xopc's workspace trust requirement; importing a project does not grant trust.

The result shows what was added, what was already present, and any items needing attention. Follow **View skills** or **View projects** to use the imported content.

## Import again

Import again adds newly discovered content. Identical items are skipped. An unrelated skill with the same name is imported under a product-prefixed name. Previously imported skills or context that have changed are kept and reported, so re-importing cannot overwrite edits in xopc. This is a snapshot import, not automatic synchronization.

## Current coverage

Codex reads `$CODEX_HOME` (default `~/.codex`), `~/.agents/skills`, and known project directories. Claude Code reads `$CLAUDE_CONFIG_DIR` (default `~/.claude`), its sibling `.claude.json`, and known project directories.

MCP connections are reported for reconnection in **Connections**. Passwords, authentication sessions, executable hooks, and product-specific permissions are not transferred. Chat history, auto-memory directories, command execution semantics, and plugin installation are not included in this release.

Only the Gateway owner can import. In a remote-Gateway setup, detection happens on the Gateway device.

## CLI

```sh
xopc import                 # List detected apps
xopc import claude-code     # Import with the same defaults as the UI
xopc import codex
```
