# TUI 对齐 Codex CLI：能力与验收

以本机 `codex-cli 0.147.0` 的实际行为为参照。Goal 不在范围内；旧 TUI 命令和占位实现直接删除，不保留兼容映射。

| 能力 | 当前实现 |
| --- | --- |
| 输入与快捷键 | Shift+Tab 切换 Plan；Ctrl+R 搜索输入历史；Ctrl+O 复制；Ctrl+L 清屏；双 Esc 默认进入分叉。slash 补全按前缀匹配，已删除命令不会被模糊替换为其他命令。 |
| Plan | 持久化会话策略；允许只读工具及 OS 沙箱内的检查命令；阻止文件写入、发布、实现委派及通用工具发现。运行、后台任务、子 Agent 未停止时拒绝切换权限。 |
| 权限 | /permissions 提供只读、工作区写入且网络关闭/开启、已配置 Agent 策略。macOS 使用 sandbox-exec，Linux 使用 bubblewrap；缺少平台支持就报错，不降级为无限制执行。 |
| 澄清与审批 | 单选、文本、批量问题、明确允许/拒绝、取消、过期检查；/answer 恢复待答请求；答复保留 version 和幂等键。 |
| 后台终端 | exec_command 和 managed_job 支持 tty:true；同一任务注册表管理 pipe/PTY 的输出、stdin、resize、超时、进程树取消和持久化结果。/terminal 接管真实终端，Ctrl+] 分离；/ps、/stop、/stdin 管理任务。 |
| 子 Agent | SQLite 持久化状态、委派能力集合和 transcript；/subagents 支持输出、独立 transcript、steer、stop、resume。恢复后使用当前配置重新构造工具，并与原能力授权取交集；失去运行时所有权标为 interrupted。 |
| 会话生命周期 | new/clear/reset 语义区分；rename、archive、delete；/archived 可阅读归档或恢复后继续，归档不混入普通恢复列表。 |
| 历史与分叉 | 编辑、fork、tree、timeline；/search 检索正文并选择命中行跳转。远程首屏使用 transcript/window，不再下载完整 transcriptRows。 |
| Diff/review | staged/unstaged/untracked diff；支持未创建首个 commit 的仓库；复用 review。查看器支持 / 搜索、n/N、g 跳行、[ 和 ] 切换 diff 文件。 |
| 图片 | -i/--image、/attach、/attachments；格式、数量和体积校验；附件可逐项移除或清空。 |
| Side chat | /side 独立临时上下文、流式文本、Escape 取消、继续追问；本地和 Gateway 都传递取消信号；切会话后的旧回答不显示。 |
| Transcript/复制 | /raw 浏览持久化 JSON；/copy code 选择代码块；复用 export。查看器在 resize 后约束标题、内容和页脚宽度。 |
| 状态/context | /status 为会话摘要；/context、/usage 保留不同统计用途；状态栏显示工作区、模式和沙箱网络状态；模型入口统一为 /model。 |
| Skills/MCP/plugins | skill picker 按 Agent allow/deny 过滤；/mcp 探测、工具清单、OAuth 启动/刷新/回调/取消/登出；/plugins 浏览市场、审查能力、安装/更新/回滚/启停/移除及设置和连接授权。安装沿用 reviewHash 校验。 |
| 工作区/工作树 | /pwd 标明宿主；/cd 把路径交给执行宿主解析并遵守项目锁定；/worktree list/create/use/remove 复用项目的受管工作树服务，绑定切换是事务。Gateway 管理操作要求 owner admin。 |
| 故障恢复与退出 | 请求归属和代次校验；停止确认、重置失败和读取失败不伪装成功；认证错误、超时明确报告。本地退出等待任务停止；Gateway 断开不杀远程任务。 |

已删除：quit、clone、aside、btw、name、restart、cancel、sessions、scopedmodels、reload-keybindings、reload-keybind、keys、models、switch、session 等旧 TUI 入口；旧跨会话 tree 面板及专用格式器；扩展会话 replacement context 的空值 UI 实现；TUI backend 的旧 btwQuery 方法。规范模型入口为 `/model`、`/model list`、`/model <provider/model>`；会话摘要为 `/status`。其他聊天界面的独立命令协议不因此改名。

边界与限制：

- 沙箱网络开关约束命令进程，不关闭模型 API 或独立 MCP/网页工具。没有实现 Codex 网络代理的域名级动态审批。Windows 原生沙箱当前不支持，选择它会明确失败；Linux 路径需要 bubblewrap，尚未在本机执行验证。
- 工作区写入沙箱也允许系统临时目录写入；只读命令禁止发布 artifacts。配置为无限制执行时仍应用已配置的工具策略。
- PTY 的 OS 进程不能跨 CLI 进程重启继续运行；结果和日志可恢复，丢失运行时的任务明确标为 interrupted。子 Agent 的 resume 是基于保存上下文启动新一轮受限执行。
- /search 最多返回 20 个命中；初始远程历史窗口最多 2000 行；终端预览为最新 8000 字符，查看器最多显示 100 万字符。SQLite 历史 outline 仍需读取历史，超大历史的 CPU/内存优化不等于已经完成。
- 真实账号的 OAuth 登录/插件第三方账号权限、完整 SSH/tmux/中文 IME 组合输入矩阵未在本机验收；测试使用隔离 fixture，不宣称这些环境全部验证通过。
- 本地免 Gateway 与远程 Gateway 都是当前运行模式。SQLite 安装数据升级链保留，不属于 TUI legacy 清理。

验收覆盖真实监听的认证 HTTP 与 lazy-bundle、真实 MCP stdio 服务、插件能力 hash 拒绝/安装/移除、工作树创建/绑定/删除、PTY 输入/resize/退出及 macOS OS 沙箱写入限制；还覆盖子 Agent 所有权、保存上下文与权限交集恢复、流式旁问和取消、历史检索及归档恢复。

真实 node-pty 验收路径：启动 → /terminal → 输入 → resize → Ctrl+] 分离 → /ps → /stop → /model list → 旧 /models 拒绝 → /status → 中文搜索 → MCP/插件菜单 → Plan → /exit，进程退出码 0。终端宽度从 110 缩到 93；另有 40/20 列的查看器宽度回归。

验证结果：143 个定向测试文件中 142 个通过、1 个跳过；1062 项测试通过、1 项跳过。随后针对恢复时 Agent 身份绑定的修改，3 个相关测试文件、15 项测试通过。TypeScript、所改 TUI/终端/策略模块的 ESLint、git diff --check 均通过。没有运行全仓库 test:all。
