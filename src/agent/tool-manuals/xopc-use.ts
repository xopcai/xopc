export const xopcUseManual = `# XOPC Use Tool Manual

## Overview

\`xopc_use\` is the unified tool for operating XOPC product objects. Use it instead of editing storage files or database rows directly.

Basic shape:

\`\`\`json
{
  "mode": "project | note | work_item",
  "command": "list | get | create | update | append | preview_edit | resolve_workspace",
  "args": { "...": "..." },
  "dryRun": false
}
\`\`\`

## General Rules

- Use \`list\` or \`get\` first when the target object is ambiguous.
- Use \`dryRun: true\` before a broad or risky change.
- Prefer additive operations over destructive replacement.
- Do not invent ids. If an id is not known, search/list first.
- Do not attempt delete/archive workflows through this tool unless the command is explicitly supported.
- For non-trivial note rewrites, use \`note.preview_edit\` before \`note.update\`.

## Projects

Projects group sessions, work items, goals, workflows, files, and project instructions.

### Find projects

\`\`\`json
{ "mode": "project", "command": "list", "args": { "search": "release", "limit": 10 } }
\`\`\`

### Read project detail

\`\`\`json
{ "mode": "project", "command": "get", "args": { "projectId": "project_id" } }
\`\`\`

### Create a project

Use when the user asks to start or formalize a project. Include \`brief\` for the concise product idea and \`instructions\` for agent-operating guidance.

\`\`\`json
{
  "mode": "project",
  "command": "create",
  "args": {
    "name": "AI Product Research",
    "brief": "Explore demand and feasibility for an AI product.",
    "instructions": "Keep decisions and open questions current."
  }
}
\`\`\`

### Update a project

Use for metadata, brief, status, or instructions. Use \`dryRun\` first when changing \`workspaceRoot\` or broad instructions.

\`\`\`json
{
  "mode": "project",
  "command": "update",
  "args": {
    "projectId": "project_id",
    "status": "active",
    "instructions": "Prioritize safe previews before changing notes."
  }
}
\`\`\`

### Resolve workspace

Use when a file path or current working directory should be mapped to a project.

\`\`\`json
{
  "mode": "project",
  "command": "resolve_workspace",
  "args": { "workspacePath": "/path/to/repo", "autoCreate": false }
}
\`\`\`

## Notes

Notes are user-owned markdown objects. Treat them as durable user content.

### Find notes

\`\`\`json
{ "mode": "note", "command": "list", "args": { "search": "pricing", "limit": 10 } }
\`\`\`

### Create a note

\`\`\`json
{
  "mode": "note",
  "command": "create",
  "args": {
    "title": "Product direction",
    "markdown": "Initial notes...",
    "tags": ["product"]
  }
}
\`\`\`

### Append to a note

Prefer append when preserving original user notes and adding AI output.

\`\`\`json
{
  "mode": "note",
  "command": "append",
  "args": {
    "noteId": "note_id",
    "heading": "AI synthesis",
    "content": "Key points..."
  }
}
\`\`\`

### Preview an edit

Use before rewriting or restructuring a note.

\`\`\`json
{
  "mode": "note",
  "command": "preview_edit",
  "args": {
    "noteId": "note_id",
    "instruction": "Summarize this as action items"
  }
}
\`\`\`

### Update a note

Use only when the user clearly wants the canonical note changed. Prefer \`append\` or \`preview_edit\` otherwise.

\`\`\`json
{
  "mode": "note",
  "command": "update",
  "args": {
    "noteId": "note_id",
    "status": "processed",
    "tags": ["product", "validated"]
  }
}
\`\`\`

## Work Items

Work items are project-scoped tasks. If \`projectId\` is omitted, the tool may inherit the current session's project binding.

### Create a work item

\`\`\`json
{
  "mode": "work_item",
  "command": "create",
  "args": {
    "projectId": "project_id",
    "title": "Validate technical feasibility",
    "description": "Check API, storage, UI, and safety implications.",
    "priority": "high",
    "status": "todo"
  }
}
\`\`\`

### Update a work item

\`\`\`json
{
  "mode": "work_item",
  "command": "update",
  "args": {
    "workItemId": "work_item_id",
    "status": "in_progress",
    "nextAction": "Prototype the xopc_use tool path."
  }
}
\`\`\`

## Safety

- \`note.update\` can replace canonical user content. Use \`preview_edit\` first for content rewrites.
- \`project.update.workspaceRoot\` changes project-file scope. Use \`dryRun\` and ask the user if intent is unclear.
- \`work_item.update.archivedAt\` hides work from normal active views. Confirm before archiving.
- If the user asks for deletion, explain that deletion is not exposed through \`xopc_use\` yet.
`;
