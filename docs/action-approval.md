# Action permissions

Chats support two action approval modes:

- **Ask for approval**: trusted reads inside the workspace and ordinary workspace patches can proceed. Network access, shell commands, destructive patches and unknown tools require approval. Workspace writes without a trusted containment contract also require approval.
- **Full access**: ordinary action prompts are skipped. Explicit tool `ask`/`deny` rules, connector confirmation policies, account scopes, filesystem restrictions, device consent and OS permissions remain effective.

The composer shows the current mode. New Web chat drafts inherit action permissions, and the resolved selection is included in their first creation command. Existing sessions and clients that omit the mode preserve the previous behavior. AI review is not available; `auto` is rejected.

The last successfully saved choice is remembered per Agent in the current authenticated Gateway context, using the same browser preference record as model and project context. New chats resolve an explicit handoff choice first, then the remembered choice, then the Agent default, then Ask for approval. Project context continues to inherit normally; the same Agent can reuse its permission choice across projects. Different Agents, Gateways and login contexts do not share this preference. Loading an older chat does not change it, and existing chats retain their own saved permissions. Browser preferences are local; set the Agent default for a shared fallback across devices.

To set an agent default, use `agents.defaults.runtime.actionApprovalMode` (`ask` or `full`), or the corresponding `agents.list` runtime override. A session can override it through the composer or the authenticated `PATCH /api/sessions/:id/agent-config` API:

```json
{
  "actionApprovalMode": "ask",
  "configVersion": 123
}
```

Read `configVersion` from `GET /api/sessions/:id/agent-config` before updating. Send permission changes separately from model/settings changes. Only Gateway owner authentication can change modes or explicitly create a full-access session. Stop active runs and background commands and resolve/cancel pending questions first. Stale or busy updates are rejected; refreshing a browser does not cancel a pending approval. `null` clears a session override.

Approval cards support **Allow once** and **Deny**. They use the existing durable clarification queue and expire after ten minutes. A valid answer resumes the suspended objective; the runtime matches the full canonical arguments, agent, workspace and current policy before consuming the decision once. Changed arguments require a new approval. Canceled or reset conversations cannot use old decisions. A denial stops the action instead of repeatedly asking.

A data batch is reviewed as a whole before its operations run. Per-operation deny rules, hooks and limits still apply. Codemode and desktop program child calls also pass through host policy. Delegation retains parent policy; persistent Task execution cannot exceed the originating conversations' current approval ceiling. Noninteractive callers block actions requiring approval.

CLI and Composio connectors request the same approval card after resolving their account, connection and operation contract. Their existing permission checks and external-operation recovery records remain authoritative. Older management/API flows without an embedded execution continue to use their existing connector confirmation contracts.

Telegram execution confirmation requirements feed this durable queue rather than creating a second agent-side exec prompt. Configured approvers receive the same approval ID; callback resolution checks the channel/account and actual sender. Without configured approvers and with the channel exec floor disabled, only the originating direct-chat user may answer. An enabled exec floor with no configured approvers cannot be approved through Telegram. Group approvals without a trusted recipient remain available in the Gateway console. This does not grant missing connector or OS permissions.

Approvals are not a sandbox. Host commands retain their configured execution environment; checking `cwd` does not restrict every file or network access made by a process. For approved shell commands, canonical cwd and bounded explicit local file operands are checked again before launch. Files up to 2 MiB receive content hashes; larger operands use file metadata. This does not pin every interpreter import, shell expansion, executable on PATH or remote server implementation. Use command isolation when a runtime boundary is required. Full access does not switch isolation off.

Remote writes retain their provider idempotency/recovery behavior. An external operation with an unknown outcome must be reconciled before retrying; approval does not guarantee exactly-once delivery to third-party services.
