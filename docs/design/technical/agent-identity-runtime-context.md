# Agent identity runtime context

Catalog-backed Gateway text sessions use the saved Agent profile as the current
source of identity. The change applies to every profile, without recognizing
name questions, specific names, languages, or providers.

## Runtime behavior

- The current system prompt contains one profile section after workspace context.
  It establishes precedence over historical dialogue, memory, and profile Markdown.
- A native pi extension reads the conversation's Agent catalog entry and session
  language preference at turn start. The snapshot covers Agent id, name, role
  (`profile.description`), type, communication style, and primary language.
- Each model request receives that snapshot immediately before the latest input.
  A changed fingerprint produces `agent_configuration_updated`, with old/current
  values; unchanged settings produce `agent_configuration_current`. Instruction
  changes affect the fingerprint without copying instruction text into the event.
- These transient custom messages are serialized by pi as user-context data.
  The system contract defines their meaning as host configuration, not a human
  request or authorization. Original human messages are unchanged and remain last.
- The extension projects the current SDK system prompt and tool declarations on
  every request. Stale historical system messages cannot carry obsolete profiles;
  tools activated during a turn retain their current declarations.
- Configuration markers persist through the existing guarded transcript append
  path only when settings change. Request snapshots do not enter the visible
  conversation. Avatar and emoji changes do not invalidate identity fingerprints.

Updates take effect on the next turn. Missing optional fields use explicit nulls
in snapshots. Runs without conversation metadata retain their provided prompts.
Response language precedence is: explicit request this turn, an applicable ongoing
conversation preference, then the configured default (session preference before global
preference). Automatic defaults follow the current user message, with the Agent primary
language used only when that message has no identifiable language. A one-turn exception
does not erase ongoing language or style preferences; unrelated profile updates do not
reset them. Name and role still come from current runtime configuration.

## Verification on 2026-10-14

The Gateway was restarted with the final source. Authenticated REST input,
realtime completion events, and SQLite assistant rows were used to verify actual
provider/model responses.

| Actual model | Passed |
| --- | --- |
| `deepseek/deepseek-flash` | 11/11 |
| `minimax-cn/MiniMax-M2.7` | 11/11 |
| `deepseek/deepseek-v4-pro` | 11/11 |

Each model used the same conversation across successive changes: Ada → Orion →
岚舟; botany → astronomy; English → Chinese → French; explicit English and fixed
Chinese overrides; restoration of the initial profile. Tests included stale SOUL
notes, old answers, a role-specific activity, and self-introduction in French
checking both current name and language. Replies were evaluated for the expected
identity, specialty, and language; full replies and actual model ids are retained
in the acceptance report（历史产物已移入 Git 历史）.

The original personal Agent's existing conversation also passed five name checks
(`haha` → 阿沐 → 岚舟 → `haha`), and its starting configuration was restored.
Disposable acceptance Agents, conversations, and workspaces were removed.

Run the reusable acceptance script with:

```sh
node --import tsx/esm scripts/verify-agent-identity-live.mjs
```

Optional environment variables select models, Gateway, config path, state root,
and report destination; see the script. Credentials are never written to reports.
The results are a finite sample of these models and text-session paths, not a
guarantee for every model or a validation of voice paths.

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
