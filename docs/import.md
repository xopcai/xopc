# Import from another AI app

Open **Settings → Import**, find Codex or Claude Code, and click **Import**. Review the detected content in one selection dialog, then click **Import selected**. Detection happens on the device where the Gateway runs. Scanning, previewing, and closing the dialog do not install skills, create projects, or add knowledge.

## Choose what to import

Only new, compatible global skills are selected initially. Rules and projects start unchecked. Selecting a project also selects its available new skills; its rules still require an explicit choice. Selecting a project child includes the project entry, and clearing a project clears its children. Search preserves selections.

Already available and incompatible items cannot be selected. Name conflicts show a proposed product-prefixed name and start unchecked. Project paths are candidates, not evidence that you want every historical directory added as a project.

## What comes across

- **Skills:** portable `SKILL.md` directories and their resources. Shared skills already available in xopc are counted as existing.
- **Working context:** user and project `AGENTS.md` / `CLAUDE.md`, plus Claude rules. These become searchable source documents with provenance, rather than replacing xopc instructions or promoting text to confirmed facts about you.
- **Projects:** existing workspace directories recorded in the source app's `projects` configuration. Existing xopc projects are matched by canonical path. Project context remains scoped to that project.

Context uses xopc's existing local-file (`workspace`) knowledge-source policy and session privacy controls. Long documents are split into small reference records for retrieval. Project skills retain xopc's workspace trust requirement; importing a project does not grant trust.

The result shows what was added, what was already present, and any items needing attention. Follow **View skills** or **View projects** to use the imported content.

## Import again

Import again adds newly discovered content. Identical items are skipped. An unrelated skill with the same name can be explicitly selected under the displayed product-prefixed name. Previously imported skills or context that have changed are kept and reported, so re-importing cannot overwrite edits in xopc. This is a snapshot import, not automatic synchronization. Lists expire after 15 minutes; refresh if selected content or destinations change. Partial results list failed items with a retry action. Network retries reuse the same request ID; retrying failed items does not repeat successful writes. Confirmed runs resume after a Gateway restart. Startup cleanup removes expired unconfirmed inventories and their unused snapshots; confirmed inventories are retained for up to 31 days for recovery, while compact run receipts remain. Existing historical projects are not removed.

## Current coverage

Codex reads `$CODEX_HOME` (default `~/.codex`), `~/.agents/skills`, and known project directories. Claude Code reads `$CLAUDE_CONFIG_DIR` (default `~/.claude`), its sibling `.claude.json`, and known project directories.

MCP connections are reported for reconnection in **Connections**. Passwords, authentication sessions, executable hooks, and product-specific permissions are not transferred. Chat history, auto-memory directories, command execution semantics, and plugin installation are not included in this release.

Only the Gateway owner can import. In a remote-Gateway setup, detection happens on the Gateway device.

## CLI

```sh
xopc import                 # List detected apps
xopc import claude-code     # Scan, select, and confirm in an interactive terminal
xopc import codex
```

With redirected input, scanning prints the inventory without importing. Automation must explicitly provide all selection arguments:

```sh
xopc import --inventory <inventory-id> --items <candidate-id,candidate-id> --request-id <uuid>
```

Include parent project IDs when selecting their children. Use `--retry-of <run-id>` to retry only failed items and their required project entries. There is no implicit import-all mode.
