# Agent 原生能力 HTTP 入口核对清单

日期：2026-09-21。按 TypeScript AST 检查核心领域路由声明，覆盖 Notes、Tasks／TaskRuns、Projects（含理解／技能）、Automations、Scenes、LocalApps。

这是一份入口核对清单，不是完成声明。`已接统一能力`仅表示该处理器可见明确 capability 调用；仍须以实施账册中的行为测试为准。`待逐项迁移／分类`不能直接按 HTTP 方法判定副作用：例如笔记 context-status 的 GET 会构建理解，Local App validate 的 POST 则只检查文件，不写验证状态；模型、文件、配置及外部执行需各自恢复协议。资源文件下载／预览继续保留专用传输，不强行变成 JSON 能力。以下路由快照较早，Scene／LocalApp 的最新迁移覆盖以实施账册为准。

所有已迁移 capability 的恢复策略：read 不产生写回执；local-write 使用同库事务和持久回执；目录／文件副作用仅由提交后的持久任务处理。未标为已迁移的写入口不得宣称具有统一恢复保障。

动态注册的 Projects `POST /api/projects/:id/pin` 与 `POST /api/projects/:id/unpin` 另计，二者均投影到 `xopc.projects.set_pinned`。本表只统计 HTTP；CLI、自动化内部、扩展内部调用方仍需核全，不能据此宣布 S0 完成。

## projects（35 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| GET `/api/projects/:projectId/environment-options` | 待逐项迁移／分类 | [execution-environments.ts:29](../../src/gateway/hono/routes/execution-environments.ts) |
| GET `/api/projects/:projectId/environments` | 待逐项迁移／分类 | [execution-environments.ts:50](../../src/gateway/hono/routes/execution-environments.ts) |
| GET `/api/projects/:projectId/skills` | 待逐项迁移／分类 | [project-skills.ts:24](../../src/gateway/hono/routes/project-skills.ts) |
| GET `/api/projects/:projectId/workspace-trust` | 待逐项迁移／分类 | [project-skills.ts:32](../../src/gateway/hono/routes/project-skills.ts) |
| PATCH `/api/projects/:projectId/workspace-trust` | 待逐项迁移／分类 | [project-skills.ts:40](../../src/gateway/hono/routes/project-skills.ts) |
| GET `/api/projects/:projectId/skills/:skillKey` | 待逐项迁移／分类 | [project-skills.ts:53](../../src/gateway/hono/routes/project-skills.ts) |
| POST `/api/projects/:projectId/skills/upload` | 待逐项迁移／分类 | [project-skills.ts:61](../../src/gateway/hono/routes/project-skills.ts) |
| POST `/api/projects/:projectId/skills/marketplace/install` | 待逐项迁移／分类 | [project-skills.ts:76](../../src/gateway/hono/routes/project-skills.ts) |
| POST `/api/projects/:projectId/skills/source/install` | 待逐项迁移／分类 | [project-skills.ts:93](../../src/gateway/hono/routes/project-skills.ts) |
| DELETE `/api/projects/:projectId/skills/:skillId` | 待逐项迁移／分类 | [project-skills.ts:111](../../src/gateway/hono/routes/project-skills.ts) |
| GET `/api/projects/:id/understanding` | 待逐项迁移／分类 | [project-understanding.ts:9](../../src/gateway/hono/routes/project-understanding.ts) |
| POST `/api/projects/:id/understanding` | 待逐项迁移／分类 | [project-understanding.ts:18](../../src/gateway/hono/routes/project-understanding.ts) |
| PATCH `/api/projects/:id/understanding` | 待逐项迁移／分类 | [project-understanding.ts:29](../../src/gateway/hono/routes/project-understanding.ts) |
| POST `/api/projects` | `xopc.projects.create` | [projects.ts:213](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects` | `xopc.projects.list` | [projects.ts:220](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects/suggestions` | 待逐项迁移／分类 | [projects.ts:240](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/infer-defaults` | 待逐项迁移／分类 | [projects.ts:245](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/resolve-workspace` | `xopc.projects.resolve_workspace` | [projects.ts:262](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects/:id/activity` | 待逐项迁移／分类 | [projects.ts:271](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/:id/digest-knowledge` | 待逐项迁移／分类 | [projects.ts:282](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/:id/blockers` | 待逐项迁移／分类 | [projects.ts:330](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects/:id` | `xopc.projects.get` | [projects.ts:377](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects/:id/milestones` | `xopc.projects.list_milestones` | [projects.ts:384](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/:id/milestones` | `xopc.projects.create_milestone` | [projects.ts:391](../../src/gateway/hono/routes/projects.ts) |
| PATCH `/api/projects/:id/milestones/:milestoneId` | `xopc.projects.update_milestone` | [projects.ts:399](../../src/gateway/hono/routes/projects.ts) |
| DELETE `/api/projects/:id/milestones/:milestoneId` | `xopc.projects.delete_milestone` | [projects.ts:409](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects/:id/updates` | `xopc.projects.list_updates` | [projects.ts:424](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/:id/updates` | `xopc.projects.create_update` | [projects.ts:433](../../src/gateway/hono/routes/projects.ts) |
| PATCH `/api/projects/:id` | `xopc.projects.update` | [projects.ts:446](../../src/gateway/hono/routes/projects.ts) |
| DELETE `/api/projects/:id` | `xopc.projects.delete` | [projects.ts:462](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects/:id/sessions` | 待逐项迁移／分类 | [projects.ts:484](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/:id/sessions/:conversationId` | 待逐项迁移／分类 | [projects.ts:498](../../src/gateway/hono/routes/projects.ts) |
| DELETE `/api/projects/:id/sessions/:conversationId` | 待逐项迁移／分类 | [projects.ts:508](../../src/gateway/hono/routes/projects.ts) |
| POST `/api/projects/:id/sessions/:conversationId/summary-knowledge` | 待逐项迁移／分类 | [projects.ts:529](../../src/gateway/hono/routes/projects.ts) |
| GET `/api/projects/:projectId/operating-view` | 待逐项迁移／分类 | [tasks.ts:315](../../src/gateway/hono/routes/tasks.ts) |

## local-apps（11 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| GET `/api/local-apps/preview/:token/*` | 待逐项迁移／分类 | [local-apps.ts:31](../../src/gateway/hono/routes/local-apps.ts) |
| GET `/api/local-apps` | `xopc.local_apps.list` | [local-apps.ts:77](../../src/gateway/hono/routes/local-apps.ts) |
| POST `/api/local-apps` | 待逐项迁移／分类 | [local-apps.ts:82](../../src/gateway/hono/routes/local-apps.ts) |
| GET `/api/local-apps/:id` | `xopc.local_apps.get` | [local-apps.ts:95](../../src/gateway/hono/routes/local-apps.ts) |
| POST `/api/local-apps/:id/validate` | 待逐项迁移／分类 | [local-apps.ts:100](../../src/gateway/hono/routes/local-apps.ts) |
| POST `/api/local-apps/:id/acceptance-runs` | 待逐项迁移／分类 | [local-apps.ts:104](../../src/gateway/hono/routes/local-apps.ts) |
| POST `/api/local-apps/:id/install` | 待逐项迁移／分类 | [local-apps.ts:113](../../src/gateway/hono/routes/local-apps.ts) |
| POST `/api/local-apps/:id/releases/:releaseId/rollback` | 待逐项迁移／分类 | [local-apps.ts:118](../../src/gateway/hono/routes/local-apps.ts) |
| POST `/api/local-apps/:id/enable` | 待逐项迁移／分类 | [local-apps.ts:126](../../src/gateway/hono/routes/local-apps.ts) |
| POST `/api/local-apps/:id/disable` | 待逐项迁移／分类 | [local-apps.ts:131](../../src/gateway/hono/routes/local-apps.ts) |
| DELETE `/api/local-apps/:id/install` | 待逐项迁移／分类 | [local-apps.ts:136](../../src/gateway/hono/routes/local-apps.ts) |

## notes（31 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| POST `/api/notes/quick-capture` | `xopc.notes.capture` | [notes.ts:94](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes` | `xopc.notes.list` | [notes.ts:111](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/project-summaries` | `xopc.notes.project_summaries` | [notes.ts:123](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes` | `xopc.notes.create` | [notes.ts:129](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/sync` | 待逐项迁移／分类 | [notes.ts:220](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/catalyze` | 待逐项迁移／分类 | [notes.ts:240](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/catalysis-feedback` | 待逐项迁移／分类 | [notes.ts:249](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/chat` | 待逐项迁移／分类 | [notes.ts:263](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id/context-status` | 待逐项迁移／分类 | [notes.ts:364](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/context-rebuild` | 待逐项迁移／分类 | [notes.ts:373](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id/threads` | 待逐项迁移／分类 | [notes.ts:382](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/append` | `xopc.notes.append` | [notes.ts:397](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id` | `xopc.notes.get` | [notes.ts:411](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id/shares` | 待逐项迁移／分类 | [notes.ts:417](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/shares` | 待逐项迁移／分类 | [notes.ts:448](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/shares/:shareId/refresh` | 待逐项迁移／分类 | [notes.ts:491](../../src/gateway/hono/routes/notes.ts) |
| PATCH `/api/notes/:id` | `xopc.notes.update` | [notes.ts:519](../../src/gateway/hono/routes/notes.ts) |
| DELETE `/api/notes/:id` | `xopc.notes.delete` | [notes.ts:542](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id/history` | `xopc.notes.history` | [notes.ts:567](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id/history/:timestamp` | `xopc.notes.snapshot` | [notes.ts:573](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/history/restore` | `xopc.notes.restore` | [notes.ts:579](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/ai/edit` | 待逐项迁移／分类 | [notes.ts:598](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/media` | 待逐项迁移／分类 | [notes.ts:615](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id/media/:attachmentId` | 待逐项迁移／分类 | [notes.ts:664](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/task` | 待逐项迁移／分类 | [notes.ts:696](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/toggle-done` | 待逐项迁移／分类 | [notes.ts:712](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/open` | 待逐项迁移／分类 | [notes.ts:718](../../src/gateway/hono/routes/notes.ts) |
| POST `/api/notes/:id/move` | 待逐项迁移／分类 | [notes.ts:724](../../src/gateway/hono/routes/notes.ts) |
| GET `/api/notes/:id/hosted-publications` | 待逐项迁移／分类 | [shares.ts:888](../../src/gateway/hono/routes/shares.ts) |
| POST `/api/notes/:id/hosted-publications` | 待逐项迁移／分类 | [shares.ts:898](../../src/gateway/hono/routes/shares.ts) |
| POST `/api/notes/:id/hosted-publications/:publicationId/refresh` | 待逐项迁移／分类 | [shares.ts:935](../../src/gateway/hono/routes/shares.ts) |

## scenes（43 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| GET `/api/scenes/source-providers` | 待逐项迁移／分类 | [scenes.ts:32](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/source-providers/:provider/accounts` | 待逐项迁移／分类 | [scenes.ts:33](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/source-providers/:provider/resolve-link` | 待逐项迁移／分类 | [scenes.ts:36](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/task-follow-ups` | 待逐项迁移／分类 | [scenes.ts:44](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/task-follow-ups/projects/:projectId/branches` | 待逐项迁移／分类 | [scenes.ts:45](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/task-follow-ups/branch-links` | 待逐项迁移／分类 | [scenes.ts:49](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/task-follow-ups/preflight` | 待逐项迁移／分类 | [scenes.ts:55](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/task-follow-ups` | 待逐项迁移／分类 | [scenes.ts:59](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/task-follow-ups/:id` | 待逐项迁移／分类 | [scenes.ts:63](../../src/gateway/hono/routes/scenes.ts) |
| PATCH `/api/scenes/task-follow-ups/:id` | 待逐项迁移／分类 | [scenes.ts:67](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/browser/prepare` | 待逐项迁移／分类 | [scenes.ts:76](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/browser/subscriptions` | 待逐项迁移／分类 | [scenes.ts:77](../../src/gateway/hono/routes/scenes.ts) |
| DELETE `/api/scenes/browser/subscriptions/:id` | 待逐项迁移／分类 | [scenes.ts:79](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/preferences` | 待逐项迁移／分类 | [scenes.ts:83](../../src/gateway/hono/routes/scenes.ts) |
| PATCH `/api/scenes/preferences` | 待逐项迁移／分类 | [scenes.ts:84](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/presence` | 待逐项迁移／分类 | [scenes.ts:86](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/templates` | 待逐项迁移／分类 | [scenes.ts:90](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/diagnostics` | 待逐项迁移／分类 | [scenes.ts:91](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/metrics` | 待逐项迁移／分类 | [scenes.ts:92](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/sources/mail/accounts` | 待逐项迁移／分类 | [scenes.ts:96](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/sources/mail/search` | 待逐项迁移／分类 | [scenes.ts:97](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/sources/mail` | 待逐项迁移／分类 | [scenes.ts:102](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/templates/:key/versions/:version` | 待逐项迁移／分类 | [scenes.ts:107](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/preflight` | 待逐项迁移／分类 | [scenes.ts:108](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/activations` | 待逐项迁移／分类 | [scenes.ts:109](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/activations` | 待逐项迁移／分类 | [scenes.ts:114](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/activations/:id` | 待逐项迁移／分类 | [scenes.ts:118](../../src/gateway/hono/routes/scenes.ts) |
| PATCH `/api/scenes/activations/:id` | 待逐项迁移／分类 | [scenes.ts:119](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/activations/:id/checks` | 待逐项迁移／分类 | [scenes.ts:130](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/activations/:id/runs` | 待逐项迁移／分类 | [scenes.ts:133](../../src/gateway/hono/routes/scenes.ts) |
| PATCH `/api/scenes/activations/:id/notes` | 待逐项迁移／分类 | [scenes.ts:138](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/activations/:id/notes` | 待逐项迁移／分类 | [scenes.ts:141](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/activations/:id/work-items` | 待逐项迁移／分类 | [scenes.ts:142](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/activations/:id/work-items` | 待逐项迁移／分类 | [scenes.ts:147](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/activations/:id/schedules` | 待逐项迁移／分类 | [scenes.ts:150](../../src/gateway/hono/routes/scenes.ts) |
| PATCH `/api/scenes/activations/:id/schedules/:triggerKey` | 待逐项迁移／分类 | [scenes.ts:151](../../src/gateway/hono/routes/scenes.ts) |
| PATCH `/api/scenes/work-items/:id` | 待逐项迁移／分类 | [scenes.ts:154](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/outcomes` | 待逐项迁移／分类 | [scenes.ts:157](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/digests/:id` | 待逐项迁移／分类 | [scenes.ts:162](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/presentations/:id/feedback` | 待逐项迁移／分类 | [scenes.ts:166](../../src/gateway/hono/routes/scenes.ts) |
| GET `/api/scenes/presentations/:id` | 待逐项迁移／分类 | [scenes.ts:167](../../src/gateway/hono/routes/scenes.ts) |
| POST `/api/scenes/presentations/:id/feedback` | 待逐项迁移／分类 | [scenes.ts:168](../../src/gateway/hono/routes/scenes.ts) |
| PATCH `/api/scenes/presentations/:id` | 待逐项迁移／分类 | [scenes.ts:171](../../src/gateway/hono/routes/scenes.ts) |

## tasks（18 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| GET `/api/tasks` | `xopc.tasks.list` | [tasks.ts:57](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/tasks` | `xopc.tasks.create` | [tasks.ts:65](../../src/gateway/hono/routes/tasks.ts) |
| GET `/api/tasks/metrics` | `xopc.tasks.metrics` | [tasks.ts:89](../../src/gateway/hono/routes/tasks.ts) |
| GET `/api/tasks/:id` | `xopc.tasks.get` | [tasks.ts:94](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/tasks/:id/conversation` | 待逐项迁移／分类 | [tasks.ts:100](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/tasks/:id/handoff` | 待逐项迁移／分类 | [tasks.ts:121](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/tasks/:id/inputs` | 待逐项迁移／分类 | [tasks.ts:149](../../src/gateway/hono/routes/tasks.ts) |
| PATCH `/api/tasks/:id/conversation/config` | 待逐项迁移／分类 | [tasks.ts:161](../../src/gateway/hono/routes/tasks.ts) |
| GET `/api/tasks/:id/conversation/history` | 待逐项迁移／分类 | [tasks.ts:169](../../src/gateway/hono/routes/tasks.ts) |
| GET `/api/tasks/:id/conversation/timeline` | 待逐项迁移／分类 | [tasks.ts:185](../../src/gateway/hono/routes/tasks.ts) |
| GET `/api/tasks/:id/conversation/find` | 待逐项迁移／分类 | [tasks.ts:190](../../src/gateway/hono/routes/tasks.ts) |
| PATCH `/api/tasks/:id` | `xopc.tasks.update` | [tasks.ts:199](../../src/gateway/hono/routes/tasks.ts) |
| DELETE `/api/tasks/:id` | `xopc.tasks.delete` | [tasks.ts:205](../../src/gateway/hono/routes/tasks.ts) |
| PUT `/api/tasks/:id/dependencies` | `xopc.tasks.update_dependencies` | [tasks.ts:224](../../src/gateway/hono/routes/tasks.ts) |
| PUT `/api/tasks/:id/board-position` | `xopc.tasks.reorder` | [tasks.ts:232](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/tasks/:id/commands` | `xopc.tasks.command` | [tasks.ts:238](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/tasks/:id/context` | `xopc.tasks.add_context` | [tasks.ts:261](../../src/gateway/hono/routes/tasks.ts) |
| DELETE `/api/tasks/:id/context/:edgeId` | `xopc.tasks.remove_context` | [tasks.ts:271](../../src/gateway/hono/routes/tasks.ts) |

## task-runs（4 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| GET `/api/task-runs/:runId` | `xopc.task_runs.get` | [tasks.ts:278](../../src/gateway/hono/routes/tasks.ts) |
| GET `/api/task-runs/:runId/events` | `xopc.task_runs.get` | [tasks.ts:286](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/task-runs/:runId/cancel` | `xopc.task_runs.cancel` | [tasks.ts:294](../../src/gateway/hono/routes/tasks.ts) |
| POST `/api/task-runs/:runId/feedback` | `xopc.task_runs.feedback` | [tasks.ts:305](../../src/gateway/hono/routes/tasks.ts) |

## automations（9 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| GET `/api/automations` | `xopc.automations.list` | [routes.ts:37](../../src/automations/api/routes.ts) |
| POST `/api/automations` | `xopc.automations.create` | [routes.ts:45](../../src/automations/api/routes.ts) |
| GET `/api/automations/metrics` | `xopc.automations.metrics` | [routes.ts:56](../../src/automations/api/routes.ts) |
| POST `/api/automations/draft` | 待逐项迁移／分类 | [routes.ts:63](../../src/automations/api/routes.ts) |
| POST `/api/automations/simulate` | 待逐项迁移／分类 | [routes.ts:97](../../src/automations/api/routes.ts) |
| GET `/api/automations/:id` | `xopc.automations.get` | [routes.ts:208](../../src/automations/api/routes.ts) |
| PATCH `/api/automations/:id` | `xopc.automations.update` | [routes.ts:216](../../src/automations/api/routes.ts) |
| DELETE `/api/automations/:id` | `xopc.automations.delete` | [routes.ts:236](../../src/automations/api/routes.ts) |
| POST `/api/automations/:id/run` | 待逐项迁移／分类 | [routes.ts:258](../../src/automations/api/routes.ts) |

## automation-runs（9 个静态入口）

| 方法／路径 | 当前调用归属 | 源码 |
| --- | --- | --- |
| GET `/api/automation-runs` | `xopc.automations.history` | [routes.ts:107](../../src/automations/api/routes.ts) |
| GET `/api/automation-runs/product-events` | `xopc.automations.product_events` | [routes.ts:119](../../src/automations/api/routes.ts) |
| GET `/api/automation-runs/:runId` | `xopc.automations.get_run` | [routes.ts:130](../../src/automations/api/routes.ts) |
| GET `/api/automation-runs/:runId/events` | `xopc.automations.run_events` | [routes.ts:137](../../src/automations/api/routes.ts) |
| POST `/api/automation-runs/:runId/read` | `xopc.automations.read` | [routes.ts:144](../../src/automations/api/routes.ts) |
| POST `/api/automation-runs/read-all` | `xopc.automations.read_all` | [routes.ts:154](../../src/automations/api/routes.ts) |
| POST `/api/automation-runs/:runId/rerun` | 待逐项迁移／分类 | [routes.ts:164](../../src/automations/api/routes.ts) |
| POST `/api/automation-runs/:runId/repair-draft` | 待逐项迁移／分类 | [routes.ts:168](../../src/automations/api/routes.ts) |
| POST `/api/automation-runs/:runId/cancel` | `xopc.automations.cancel` | [routes.ts:198](../../src/automations/api/routes.ts) |
