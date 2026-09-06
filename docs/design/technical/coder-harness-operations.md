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
  "network": false
}
```

请替换成已经安装在本地 Docker daemon 的真实镜像摘要。运行时使用 `--pull=never`；镜像或 daemon 不可用就失败，不隐式下载，也不回退到宿主执行。`mode: "host"` 是宿主执行；原有命令字符串/路径检查只属于预检查，不是 OS 安全边界。

Docker 模式只挂载 workspace 到 `/workspace`，根文件系统只读，默认无网络，并限制 capability、进程数、内存和 CPU。不挂载 Docker socket，不传入宿主凭据环境；使用镜像内的工具和依赖。命令应使用 workspace 相对路径。依赖宿主绝对路径的环境（例如外部 pnpm store 或 managed worktree 的外置 Git 管理目录）需在镜像/项目中另行准备，不能假定完全兼容。配置与行为依据 [Docker run 官方文档](https://docs.docker.com/reference/cli/docker/container/run/)。

本机 Docker daemon 未运行。本轮验证了配置边界、cwd 符号链接逃逸拒绝和启动失败不回退宿主；真实容器内的成功执行、网络隔离与取消清理还需在启用 daemon 后做集成验证。

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
