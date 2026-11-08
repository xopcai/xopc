# 终端界面

终端界面是全屏本地聊天客户端。希望交互使用 xopc，但不打开桌面或浏览器控制台时使用它。

## 启动

```bash
xopc
```

等同于：

```bash
xopc tui
```

它使用当前 xopc Profile、默认 Agent、模型配置和本地 Session 存储。

## 恢复工作

```bash
xopc resume
xopc resume <session-key>
```

不知道 key 时先运行 `xopc session list`。

## 连接 Gateway

Session 和 Agent 位于另一个运行中的 xopc 实例时，使用 Gateway 模式：

```bash
xopc tui --gateway
xopc tui --url <gateway-url>
```

通过支持的提示或参数提供 Gateway Token，不要把它留在共享 Shell 历史中。

## TUI 还是交互式 CLI？

| 模式 | 适合 |
| --- | --- |
| `xopc` / `xopc tui` | 带实时进度的全屏对话 |
| `xopc agent -i` | 简单逐行交互 |
| `xopc agent -m "…"` | Shell 或脚本中的单次请求 |

## 故障排查

- TUI 立即退出：运行 `xopc doctor` 和 `xopc models status`。
- 文字显示异常：使用 UTF-8 终端和支持所需字符的字体。
- Agent 或 Session 错误：检查 `xopc profile list`、`xopc config path` 和 Gateway URL。
- 远程进度断开：验证隧道或网络，并在主机运行 `xopc gateway health`。

## 常用控制

- `Shift+Tab` 或 `/plan [on|off]` 切换规划模式：允许检查、澄清和 OS 只读沙箱内的命令，阻止写入、发布和实现委派。
- `/permissions` 选择只读、命令网络关闭/开启的工作区沙箱，或已配置的 Agent 策略。macOS 使用 sandbox-exec，Linux 需要 bubblewrap；缺少支持就明确报错。切换前需要停止当前运行、后台任务和子 Agent。
- `/answer` 重新打开待答问题或审批；审批明确区分允许与拒绝。
- `/ps [id]` 查看后台任务与实时输出，`/stop <id|all>` 停止，`/stdin <id> <text>` 发送输入。tty:true 任务使用真实终端，`/terminal <id>` 接管，Ctrl+] 分离而不停任务。
- `/subagents [id]` 查看委派执行，`/subagents stop <id>` 请求停止；菜单还支持打开保存的 transcript、steer 和 resume。
- `/diff` 查看 staged、unstaged、untracked 修改；`/review` 进入已有审查流程。
- `/side [问题]` 打开临时旁问；答案页 Enter 继续追问，Escape 关闭，不改变主会话运行状态。
- `/raw` 浏览持久化 transcript JSON；`/copy` 复制最近回答，`/copy code` 选择代码块。
- `/rename <名称>`、`/archive`、`/delete` 管理当前会话；归档和删除需要确认。
- `/new` 新建会话；`/clear` 同时清空视图；`/reset` 在原会话内更换 transcript。
- `/pwd` 显示执行宿主和工作区；`/skills` 选择技能；`/mcp`、`/plugins` 支持探测、授权和插件生命周期管理。

`Ctrl+R` 搜索输入历史，`Ctrl+O` 复制最近回答，`Ctrl+L` 清空视图。实际绑定见 `/hotkeys`。

使用 `xopc tui --image <文件...>` 或 `/attach <路径>` 添加本机 PNG、JPEG、GIF、WebP 图片。`/attachments` 查看，`/attachments <序号>` 移除一项，`/attachments clear` 清空。即使连接 Gateway，附件路径也属于运行终端的机器。

旧入口 `/quit`、`/btw`、`/aside`、`/clone`、`/name` 已删除，请使用 `/exit`、`/side`、`/fork`、`/rename`。旧 `/models`、`/switch`、`/session` 也已删除，分别使用 `/model list`、`/model <provider/model>`、`/status`。本轮对齐不包含 Goal。

`/archived` 可阅读归档或恢复后继续。`/search <内容>` 搜索正文并选择命中行。输出和 diff 查看器支持 `/` 搜索、`n`/`N` 切换命中、`g` 跳行、`[`/`]` 切换 diff 文件；旁问流式显示，Escape 取消。

`/mcp [probe|tools|login|logout] <server>` 管理连接；OAuth 页面可刷新状态、粘贴回调或取消。`/plugins` 打开安装列表和市场，`/plugins install <source>` 先审查能力再安装；也支持更新、回滚、启停、移除、配置和授权。配置 JSON 文件属于运行终端的本机。

`/cd <路径>` 由执行宿主解析并遵守项目锁定；`/worktree [list|create [base]|use <id>|remove <id>]` 管理项目工作树，变更前必须停止运行。Gateway 模式中的 `!`/`!!` 仍在本机启动目录执行。

沙箱网络开关只约束命令进程，不关闭模型 API 或独立 MCP/网页工具；尚未实现域名级动态网络审批。Windows 原生沙箱不支持。进程结果和日志可跨重启读取，运行中的 OS 进程不会跨 CLI 重启继续存活。
