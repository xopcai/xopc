# Coder harness 使用与验证

本轮实现复用 embedded runtime、SQLite transcript、execution environments 和 coder evaluator。它改善执行与验证的可追溯性；尚未通过真实模型实验证明与 Codex / Claude Code 的能力差距。

## 执行与回执

- `exec_command` 默认等待完成；设置 `yieldTimeMs` 后返回 job id。通过 `managed_job` 的 `wait` / `status` / `stdin` / `cancel` 管理同一进程。`stdin` 是管道输入，不提供 PTY。
- 命令默认运行上限 30 分钟，绝对上限 4 小时；显式工具策略可以进一步缩短。用户取消与超时分别记录，取消会终止进程树。
- 日志与结束回执位于状态目录的 `command-runs/<session-hash>/`，权限为私有目录/文件。单日志最多 8 MiB，模型上下文只接收有界输出。每个 owner 在后续启动命令时清理超过 7 天或超过 500 条的已结束记录。
- 重启后仍能查询结束回执。无法确认归属的运行记录显示 `interrupted`，不重用旧 PID、不自动重启命令；容器名会保留，便于检查清理。
- coder 的代码变更需要在当前工作区版本上运行检查，并通过 `review_workspace` 查看 tracked / untracked 内容。这个检查流程最多自动补充一轮，仍受原有轮次与超时预算限制。
- Git 指纹包含 HEAD、工作区差异和未追踪文件内容，支持尚无首个提交的仓库。执行检查期间或检查后发生的修改会使证据失效。非 Git 工作区或无法完整读取的工作区不会被标成已验证。
- “命令成功”只表示该命令成功退出，不等同于验收标准全部达成。任务 judge 仍需对照验收标准，且不能越过缺失、失败或过期的编程验证记录。

## 仓库工具

`read_file`、`write_file`、`apply_patch`、`grep`、`find` 和产物发布默认限制在当前工作区，拒绝外部绝对路径与 `..` 逃逸。仅裸 profile 文件名（如 `SOUL.md`）可以使用配置的 profile 目录。敏感路径在规范化与符号链接解析后都会检查；`.env` / `.env.*`、凭据目录及 xopc 配置/数据库不可通过这些工具读取或修改。搜索结果也执行文件策略检查，不返回硬链接文件。

目录列表、媒体发送、图片输入/输出及目录分享同样执行工作区文件策略；目录分享遇到敏感文件或逃逸链接会拒绝。工作区审查过滤敏感的 tracked / untracked 文件，并把结果标为不完整，不将受限文件计作已完成审查。

文件读写在实际 I/O 时重新校验路径，通过 `O_NOFOLLOW` 打开普通文件、核对 inode，并在校验成功后才截断写入；拒绝悬空链接、硬链接和特殊文件。此实现减少路径替换风险，但不提供跨平台 `openat2` 级别的原子目录约束，不能用于防御能够并发修改宿主目录树的恶意本地进程。

`read_file` 支持一基 `offset` 和 `limit`；`grep` / `find` 使用 ripgrep，遵循忽略文件，不再同步遍历并读取整棵目录。搜索出错明确失败，不伪装成无匹配。

运行时加载 Git 根目录至目标路径的 `AGENTS.md`，较深目录规则仅覆盖相应子树。新增规则在下一次模型请求才算送达，避免一批并行调用中后续写操作跳过规则。文件修改后会重新加载；跨仓库的指令文件符号链接不被跟随。

`language_diagnostics` 使用当前 workspace 下安装的 TypeScript 编译器，以 `--noEmit` 运行 tsconfig 项目，返回文件、行列、错误编号及完整命令日志路径。其他语言继续使用各自的检查命令；此处没有引入完整的 LSP 服务或符号索引系统。

`review_workspace` 显示当前 HEAD 以来的完整工作区变化，包含原有用户改动。大文件、二进制未追踪文件或超过输出上限的差异会标为不完整，不作为完整审查凭证。

## 可选 Docker 隔离

配置位于 `agents.defaults.runtime.commandIsolation`，也可以由 `agents.list` 对应 agent 的 `runtime.commandIsolation` 覆盖。例如：

```json
{
  "mode": "docker",
  "image": "registry.example.com/dev/node@sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "network": false,
  "workspaceAccess": "read-only"
}
```

请替换成已经安装在本地 Docker daemon 的真实镜像摘要。运行时使用 `--pull=never`；镜像或 daemon 不可用就失败，不隐式下载，也不回退到宿主执行。`mode: "host"` 是宿主执行；原有命令字符串/路径检查只属于预检查，不是 OS 安全边界。

Docker 模式只挂载 workspace 到 `/workspace`，根文件系统只读，默认无网络，并限制 capability、进程数、内存和 CPU。不挂载 Docker socket，不传入宿主凭据环境；使用镜像内的工具和依赖。命令应使用 workspace 相对路径。依赖宿主绝对路径的环境（例如外部 pnpm store 或 managed worktree 的外置 Git 管理目录）需在镜像/项目中另行准备，不能假定完全兼容。配置与行为依据 [Docker run 官方文档](https://docs.docker.com/reference/cli/docker/container/run/)。

未配置隔离时仍默认 host。host 下的脚本拥有宿主用户权限，文件工具的工作区限制不能约束脚本内部的文件或网络访问。

Docker 工作区默认只读；需要命令修改工作区时，显式设置 `workspaceAccess: "read-write"`，这会修改真实宿主文件。`network: false` 完全禁网；`network: true` 明确开启 bridge 网络，不提供域名/IP 白名单，应仅用于允许联网的可信任务。

启动前遍历工作区，以只读空文件/不可访问目录遮蔽 `.env*`、凭据目录、`.xopc` 及多硬链接文件，显式可写模式同样遮蔽。敏感符号链接、socket/FIFO/device、扫描失败或扫描超限会拒绝启动。扫描最多 200,000 个目录项，遮蔽最多 2,048 个目标。硬链接依赖（例如部分 pnpm store 布局）会不可用，应使用镜像内依赖或工作区内的普通文件。遮蔽只覆盖启动时识别到的路径，不对任意命名的秘密做内容识别；运行期间宿主新写入的文件也不自动遮蔽。

容器额外限制文件描述符，禁用 core dump、额外 swap 和 Docker 日志，避免绕过应用日志上限。

Docker 集成测试需要可用 daemon 和本地已安装、包含 Node.js 的镜像。设置 `XOPC_TEST_SANDBOX_IMAGE` 为真实的 `name@sha256:…`，运行 `pnpm exec vitest run src/agent/commands/__tests__/command-isolation.integration.test.ts`，验证真实的只读边界、凭据遮蔽、断网、显式写入和取消清理。未设置该变量时测试明确跳过，不算作隔离验证通过。

Git 命令没有专门的拦截或告警；与 Git 拼接的通用危险 shell 命令仍接受安全检查。

## 委派与恢复

`delegate_task` 提供三个模式：

- `inspect`：默认模式，只允许读取和检索。
- `review`：独立检查真实源码与差异，返回定位明确的发现；工作区在 review 期间变化会使结果过期。
- `implement`：要求已绑定项目且起始 Git 工作区干净；创建独立 managed worktree。结果保留在该环境中，由父任务审查、集成，再验证父工作区，不自动合并。

子任务最多 60 次工具调用、5 分钟，并在报告的累计 token 使用达到 100k 后停止后续请求。已经发出的模型请求可能越过 token 阈值。子任务不能继续委派、发外部消息或创建后台任务。源码与验证沿用主任务的 embedded harness；持久 workflow 子会话沿用 SQLite 追加写入，删除了原有整段 `saveMessages` 重写路径。

运行开始与最终验证记录保存在 transcript 中。中断后恢复时重新比较工作区版本，不因历史记录曾通过就直接继承成功。worktree 清理失败时保留会话绑定；再次连接会校验环境健康，避免丢失恢复入口。

## 评测与剩余验证

[coding-core 评测说明](../../../evals/coder/suites/coding-core/README.md) 包含 8 个修复任务和隐藏行为测试，涉及边界条件、异步并发、取消、路径、事务及跨文件金额计算。16 次确定性校准验证了原始代码均失败、参考修复均通过；校准不用模型，不能作为模型成功率。

真实模型对比需固定模型、reasoning、代码版本、fixture commit、预算及重复次数。当前未运行这类对比，也未实现独立的 Codex/Claude CLI adapter。完整 PTY、更广的语言服务和更大真实项目任务集属于后续能力扩展，不能以本轮单元测试数量替代其效果验证。
