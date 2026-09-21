# Slack 开发场景首版实现说明

> 历史记录：本文件描述已被替换的 Slack 专用原型，不再作为当前实现或使用说明。当前实现见[通用场景任务跟进方案](./scene-task-follow-up.md)与[使用说明](../scenes.md)。下文专用路径、Agent、API 和 Docker 前提已废弃，仅保留当时验收事实。

更新：2026-09-21。状态：开发及隔离验收，未发布。用户新增 BYOK Slack 连接后，已通过真实 Slack → Task → 内置模型编码 → Docker → 新回复继续同一任务／分支的组件集成验收（独立测试数据库和合成仓库）。最终 19 项测试及独立行为断言通过；真实业务仓库与持续个人试用仍是门禁，详见[实施记录](./scenes-implementation-progress.md)。

## 产品范围

首先解决明确委托后重复复制消息、人工盯 thread、分支无法反查需求的问题。首版不发现尚未委托的新事项，不声称已经消除整个 Slack 收件箱的遗漏。用户一次提供账号、thread、项目和目标；默认只读排查，显式选择编码后才开放独立工作区写入与批准的验证命令。

正常观察和执行不发进度通知。需要用户决定、缺少关键证据或恢复失败时进入原 Task 的等待／注意力状态；用户回答后自动继续原事项。测试失败允许同一 TaskRun 内一次额外修复，仍受总预算约束。代码通过测试进入审阅，不自动关闭业务任务或发布代码。

模型结果允许完整 JSON 代码围栏；回执不符合结构时，至多进行一次禁用所有工具的格式修复，共享原调用预算。修复不能重复编码动作或跳过最终验证；再次无效仍失败，不猜测成功。

回执 `remainingWork` 仅包含当前版本尚未完成的要求。等待未来消息由宿主承担，不作为当前阻塞；预告未来要求不授权模型猜测实现。当前要求冲突／缺少关键证据才需要用户介入；非阻塞限制保留在 summary，不以误填空数组替代必要的人工判断。

## 实际架构

| 职责 | 实现 |
| --- | --- |
| 入口及低配置表单 | `web/src/features/scenes/development-scene.tsx`；复用 Scene 模板与原详情容器 |
| Slack 来源 | `src/gateway/scenes/slackDevelopmentSource.ts`；既有 Composio 账号、策略和只读执行接口 |
| 持续委托 | `src/scenes/development/service.ts`；Gateway Scene 宿主有界轮询，不新增 DAG／队列产品 |
| 任务状态 | 既有 Task、TaskRun、TaskContext、等待、回执与 TaskRunDispatcher |
| 编码执行 | `DevelopmentAgent` 使用真实 pi Agent 与现有 BYOK／模型流；仅受限文件工具及固定验证工具 |
| 代码资源 | 既有 ExecutionEnvironmentStore／LocalWorktreeManager；任务分支及环境操作身份耐久记录 |
| 验证 | 既有 Docker command isolation；固定 digest、断网、只读源码、凭据遮蔽、无宿主回退 |
| 旧分支 | `branchInventory.ts`；本地分支／worktree 盘点及确认 SHA 的归属注释 |

`DevelopmentSource` 与 `DevelopmentExecutor` 是小型内部适配边界，测试也通过它们注入外部替身。未来来源可实现相同快照契约；第二执行器必须满足权限、停止和回执契约，不能只替换 provider 名称。尚未暴露用户自定义执行器 API／任意 Skill 工具授权或 Scene 编译器。复杂通用 Workflow、增强 Extension、邮箱编码场景等待真实复用后扩展。

当前方法来自模板 prompt，业务排查、相关性判断和修复步骤由 Agent 决定；确定性代码仅管理身份、权限、游标、预算、资源、验证和状态。没有写死具体问题的修复流程，也没有把所有业务动作交给无约束 prompt。

## 持久化与一致性

普通 SQLite v190 迁移新增三张表，不重跑旧 Proactive 数据清理：

- `scene_development_bindings`：Scene—Task—thread 唯一身份、环境与资源操作 ID、observed／delivered／applied 修订、用户决定投递指纹、执行栅栏、轮询与失败退避。
- `scene_development_revisions`：完整文本快照、来源内容指纹、观察时间。只在完整读取成功后推进，重试不重复建 Task。
- `scene_development_branch_links`：owner／workspace／project／branch 到 Task 的人工确认及当时 commit SHA；不赋予写权限。

消息与反应元数据区分：新增、编辑、删除会改变来源指纹；仅反应变化不重复派发。分页未完、非当前 thread、workspace 不匹配均拒绝。不用连接成功推断可读取所有频道。每次连接器调用前后重查当前授权。

同一任务新修订会保留人工调整的契约，仅更新来源修订验收项；旧回执不能证明新版本已完成。Agent 输入包含当次证据、当前任务契约及用户回答。当前 `applied` 仅用于通过批准命令且交付前来源仍新鲜的编码版本；只读调查不会显示为代码已验证。

资源创建先保存 operation ID；重启先核对原资源，不重复创建分支。一个 Scene／Task 同时只有一个活动写者。重启或容器终止状态不明时保留栅栏与工作区，阻止再次编码，核对后由用户恢复。

文件修改复用路径／凭据策略；禁止 `.git`／`.xopc`，包含路径别名检查。已有文件必须先读，写前比对摘要，避免覆盖期间的人工编辑。交付验证前后对 Git HEAD、分支及 tracked／非忽略文件内容取指纹；测试通过不能用于期间变化后的文件。忽略的构建依赖不在源码指纹范围，镜像、依赖和可信基线仍需真实验收。

## API 与运行预算

全部使用既有鉴权及 `/api/scenes` lazy route family：

- `GET /development/accounts`、`POST /development/resolve-link`、`POST /development/preflight`。
- `GET/POST /development`、`GET/PATCH /development/:id`（暂停、恢复、结束，以及显式授权只读事项继续编码）。
- `GET /development/projects/:projectId/branches`、`POST /development/branch-links`。

以上路径省略公共前缀 `/api/scenes`。开发场景不能通过通用 activation 配置接口绕过专用状态控制。全部主体校验、输入校验及 expectedRevision 控制沿用产品约定。

当前固定上限：每 thread 200 条消息／10 页／32,000 字符，每个场景最多 1,000 个来源修订，每账号／workspace 每日 3,000 次连接器请求，每 Task 每日 10 次执行。每次执行最长 10 分钟，最多 25 次模型调用、80 次工具调用、4 次验证，每个验证最长 120 秒。源码指纹最多 20,000 文件／256 MiB。超限不截断成成功；模型／工具超限需检查，运行日预算到次日再尝试。

连接器读取失败指数退避，三次失败进入需处理状态。单 Gateway 关闭／休眠期间不会观察；恢复后补读最新完整 thread，而非依赖只存在内存的事件。该版本不是无限频道监控服务，多个高频 thread 共享账号额度，需真实负载验证。

## 已知限制与剩余验收

- 只有文本证据；附件列出未读取标记，不下载或伪装理解截图／日志文件。
- 一 thread 对应一 Task、一仓库；调查结束后可显式授权同一事项继续编码，目标／权限的自然语言重配置尚未开放，避免无提示扩权。
- 提供本地分支盘点，不读取 PR，不自动推断归属，不接管旧分支上的未提交修改。
- 开发状态以 Task／Scene 专用详情展示；已有只读 Scene 的模型费用／成果统计不应解读为开发运行全量统计。
- 暂停和静音有效；开发提醒复用 Task 通知链路，尚未承诺所有只读 Scene Web Push 的免打扰／摘要能力或真实终端送达。
- 无外部 Codex、频道发现、push／PR／Slack 回写、自动合并／部署。
- 未配置常在线 Gateway、真实 Slack 授权及 thread、明确测试仓库、固定摘要且依赖完备的 Docker 镜像时，不能宣称真实闭环通过。

前端按现有设计系统实现。UI/UX skill 用于渐进展示编码授权与隔离选项、提交反馈及窄屏检查，不引入新的设计 token 或组件系统。

复验入口：`pnpm vitest run src/scenes src/gateway/scenes src/execution-environments src/tasks src/notifications`；`pnpm exec tsx scripts/development-scene-smoke.mts`（真实浏览器／HTTP／SQLite／worktree，Slack／执行器／验证替身）；`pnpm exec tsx scripts/scenes-gateway-smoke.mts`（Node 构建产物正式启动链及本地模型 HTTP fixture）。真实 pi 工具循环另由 `agent.test.ts` 的本地 SSE 模型验证，不等同于真实付费模型质量验收。

真实容器复验：指定已安装的 digest-pinned Node 镜像 `XOPC_SCENE_TEST_IMAGE`，运行 `pnpm exec tsx scripts/development-docker-smoke.mts`。仅创建合成临时文件与受限容器，使用正式验证器，结束后清理本次容器及临时目录；不读取业务仓库、不自动拉取镜像。

真实模型复验（会使用现有模型额度）：同时指定 `XOPC_SCENE_LIVE_MODEL=1` 与上述镜像，运行 `pnpm exec tsx scripts/development-agent-live-smoke.mts`。第一阶段修复合成计算器；将输出的测试目录作为脚本参数再次运行，验证同一 worktree 的输入校验追加需求。脚本保留代码、分支与阶段报告供审阅，并在容器内用 Agent 无法修改的独立断言检查行为。来源为显式合成证据，不伪装 Slack 读取或 TaskRun 端到端测试。

真实 Slack 组件集成复验：`scripts/development-slack-live-smoke.mts` 需要 `XOPC_SCENE_LIVE_MODEL=1`、`XOPC_SCENE_TEST_IMAGE`、`XOPC_SCENE_TEST_ACCOUNT`、`XOPC_SCENE_TEST_THREAD` 和 `XOPC_SCENE_TEST_LIVE_DB`（运行中 Gateway 的数据库路径，只读选定账号元数据），可指定本机 `XOPC_SCENE_TEST_GATEWAY`。应使用明确授权的测试账号和合成计算器需求线程；首轮成功后在该线程追加有限数字输入校验需求，将测试目录作为参数再次运行。脚本不代发 Slack 消息、不更改全局配置；最终暂停隔离 Scene 并保留报告。鉴权路由和组件为正式实现，但不冒充用户主 Gateway 的场景上线验收。
