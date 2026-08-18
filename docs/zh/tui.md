# 终端界面（`xopc` / `xopc tui`）

直接运行 **`xopc`** 会打开与 **`xopc tui`** 相同的全屏终端对话界面，底层使用 [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui)。流式展示助手回复、工具调用与思考块，体验上接近网关网页聊天，但完全在终端内完成。

命令行参数与速查见 [CLI 命令参考 — tui](./cli.md#tui)。

---

## 两种运行方式

| 方式 | 参数 | 是否需要网关 | 适用场景 |
|------|------|----------------|----------|
| **嵌入式** | 默认；`xopc` 或 `xopc tui` | 不需要 | 仅用本机配置与工作区快速对话，不经过 HTTP |
| **网关模式** | `--gateway`、`--url`、`--token` | 需要已启动的 `xopc gateway` | 与 Web 控制台共用会话、连接远程网关 |

---

## 网关模式

1. 先启动网关（见 [网关服务](./gateway.md)）。
2. 将 TUI 指到网关的根地址；若网关启用鉴权，需带上令牌：

```bash
xopc tui --gateway
xopc tui --url http://localhost:18790 --token <你的网关令牌>
```

网关模式会优先使用配置中的 gateway URL；默认 gateway 端口是 **18790**。如果网关运行在其它主机或端口，请用 **`--url`** 显式指定。

查看或生成令牌：

```bash
xopc gateway token
```

---

## 嵌入式模式（默认）

在**进程内**运行 **`AgentService`**（与无 TUI 的 `agent` 命令同源）：读取 `xopc.json`、工作区与默认模型，**不**依赖网关进程。

```bash
xopc
xopc tui
```

未显式指定 agent 时，新 TUI 会话使用 `tui.defaultAgent`。内置 starter agent 可用时默认值是 `coder`。它与 `agents.default` 分离；后者仍用于全局路由和非 TUI 会话创建。

可以在 Web 控制台的智能体页面修改，也可以用 CLI 或 TUI 内命令修改：

```bash
xopc tui --set-default-agent coder
```

TUI 内：

```text
/tui-default-agent coder
```

**嵌入式模式下的限制：**

- 嵌入式模式现在使用与 agent/gateway 路径相同的 SQLite-backed session store，支持历史、会话列表、模型列表、会话配置 patch、压缩、导入/导出、fork、transcript tree label 和 share helpers。
- 少量 gateway-only 的运维状态仍来自 gateway broadcast stream，进程内运行时不可用。
- **`/reset`** 和 **`/new`** 会重置 session transcript（归档并生成新的 `sessionId`），同时保留相同 session key 和已持久化 overrides。嵌入式模式走进程内 reset 路径；gateway 模式调用 `POST /api/sessions/:key/reset`。

---

## 命令行参数

| 参数 | 说明 |
|------|------|
| `--url <url>` | 网关根 URL（不要带路径后缀）。 |
| `--token <token>` | 网关 `Authorization: Bearer` 令牌。 |
| `-s, --session <key>` | 要恢复的会话键；省略时新建 `agent:{currentAgent}:tui-<uuid>` 会话，并在退出后打印恢复命令。 |
| `--agent <id>` | 为本次新 TUI 会话指定 agent，仅覆盖本次启动的 `tui.defaultAgent`。 |
| `--set-default-agent <id>` | 持久化 `tui.defaultAgent` 后退出；目标 agent 必须存在且已启用。 |
| `-m, --message <text>` | 连接成功后自动发送一条消息，界面保持打开。 |
| `--local` | 显式使用嵌入式模式（与默认行为相同）。 |
| `--gateway` | 强制使用网关模式。 |
| `--theme <name>` | 主题：`auto`、`dark`、`light`，或 `~/.xopc/themes/` 下的自定义主题。 |
| `--thinking <level>` | 思考等级覆盖，语义与网关 / `agent` 一致。 |

示例：

```bash
xopc tui -s agent:main:telegram:default:direct:123456
xopc tui --agent coder
xopc tui --set-default-agent coder
xopc tui -m "帮我总结收件箱"
xopc tui --url http://192.168.1.10:18790 --token "$TOKEN"
```

退出后会打印类似下面的命令：

```bash
To resume this session: xopc tui --session agent:main:tui-019eddd8-d108-7554-b971-33366f99dd27
```

---

## 键盘与输入

| 按键 | 行为 |
|------|------|
| **Enter** | 提交当前行（普通消息或以 `/` 开头的命令）。 |
| **Escape** | 中止当前正在进行的助手回复（若有）。 |
| **Ctrl+D** | 退出 TUI。 |
| **Ctrl+C** | 输入框非空时清空；为空时第一次提示再按退出，约 1 秒内第二次按确认退出。 |
| **Ctrl+O** | 展开/折叠工具调用块。 |
| **Ctrl+T** | 切换是否在流中显示思考内容。 |

以 **`/`** 开头的行视为 **斜杠命令**（不会发给模型）。编辑器会对命令名做补全。

---

## 斜杠命令

`/help` 会打印运行时真实命令列表，包括 skill、workflow 和 extension 动态注册的命令。

### Agent、模型和会话

| 命令 | 说明 |
|------|------|
| `/agent` | 显示当前 agent id 和 session key。 |
| `/agent <id>` | 切换到另一个已启用 agent，session key 会改写为 `agent:<id>:<current-session-suffix>`。它**不会**迁移已有 transcript，且助手正在回复时不能切换。 |
| `/agents` | 有 overlay 时打开 agent 选择器；否则列出已配置 agents。 |
| `/tui-default-agent <id>` | 持久化新 TUI 会话默认 agent；当前会话不变。 |
| `/model [搜索词]` | 打开模型选择器，可用搜索词过滤。 |
| `/models` | 列出可用模型。 |
| `/switch <provider/model>` | 切换当前会话模型；可先用 `/models` 复制合法 model ref。 |
| `/scoped-models` | 选择 **Ctrl+P / Shift+Ctrl+P** 循环切换时使用的模型集合。 |
| `/session` 或 `/status` | 显示当前会话、agent、模型、活动状态和统计。 |
| `/usage` | 显示当前会话 token 使用统计。 |
| `/list` | 列出会话。 |
| `/resume` 或 `/sessions` | 打开会话选择器（**Ctrl+Shift+P**）。 |
| `/tree` | 可用时打开 transcript/session 树；否则打印分组会话树。 |
| `/name [名称]` | 查看或设置当前会话显示名称。 |
| `/new` | 创建新的隔离 `tui-<uuid>` 会话。 |
| `/fork [message-id]` | 从某条用户消息或当前 transcript fork 到新会话。 |
| `/clone [名称]` | 复制当前会话 transcript 到新会话。 |
| `/reset` 或 `/restart` | 必要时中止当前运行，重置当前会话 transcript，并重新加载历史。 |
| `/clear` | 只清空当前 TUI 可见日志；不会重置已保存 transcript。 |

### 运行控制

| 命令 | 说明 |
|------|------|
| `/abort`、`/stop`、`/cancel` | 中止当前运行。 |
| `/recover` | 重新加载历史，并在可用时重新附着到停滞的流。 |
| `/retry` | 必要时中止当前运行，然后重新发送最后一条用户消息。 |
| `/thinking` | 开关思考区显示（等同 **Ctrl+T**）。 |
| `/think [off\|low\|medium\|high]` | 查看或设置 thinking level；无参数时有 overlay 则打开选择器。 |
| `/reasoning [off\|on\|stream]` | 查看或设置 reasoning 可见性。 |
| `/verbose [off\|summary\|debug]` | 循环或设置 verbose 输出等级。 |
| `/tools` | 开关工具块展开（等同 **Ctrl+O**）。 |
| `/compact [原因]` | 压缩会话历史；压缩期间消息会排队。 |
| `/copy` | 在剪贴板能力可用时复制最后一条助手回复。 |
| `/btw <问题>` 或 `/aside <问题>` | 用当前会话作为只读背景问一个旁路问题，答案不会写入会话。 |
| `/exit` 或 `/quit` | 退出 TUI。 |

### 配置和诊断

| 命令 | 说明 |
|------|------|
| `/settings` | 打开 TUI 设置 overlay：主题、思考展示、工具展开、双 Escape 行为、终端进度等。 |
| `/hotkeys` 或 `/keys` | 显示解析后的快捷键，包括 `~/.xopc/keybindings.json` 覆盖。 |
| `/reload` | 重新加载快捷键、TUI 设置、主题和 extension UI。 |
| `/reload-keybindings` | 重新加载 `~/.xopc/keybindings.json`。 |
| `/config` | 显示当前 TUI / 会话配置。 |
| `/context` | 显示上下文预算和使用情况。 |
| `/trust` | 打开项目 trust 选项，或打印 trust / 安全策略详情。 |
| `/login [provider]` | 在 TUI 内执行支持的 OAuth provider 登录。API key provider 仍用 `xopc auth set` 或 `xopc providers set-key`。 |
| `/logout [provider]` | 无参数时列出已保存 auth profiles；带 provider 时删除该 provider 的已保存 profiles。环境变量和配置文件凭据不会变化。 |
| `/debug` | 将 TUI debug 快照写入磁盘。 |
| `/changelog` | 显示版本历史。 |
| `/start` | 重新显示启动欢迎信息。 |

### 文件、workflow 和扩展

| 命令 | 说明 |
|------|------|
| `/export [路径或格式]` | 将当前会话导出为 Markdown、HTML 或 JSON。 |
| `/import <path>` | 导入 xopc JSON 会话导出。 |
| `/share <workspace-path> [friend\|colleague\|public] [--site\|--zip\|--file]` | 为工作区文件、目录或站点创建分享链接。 |
| `/workflow list` | 列出已配置 workflow 定义。 |
| `/workflow view <name>` | 查看 workflow 详情。 |
| `/workflow:<name> [goal]` | 直接启动一个 workflow run。未知 `/name` 如果匹配 workflow，也可能被改写为 workflow run。 |
| `/skill:<name> ...` | skill 提供的命令会转发给 agent。 |
| Extension commands | 扩展可以注册 TUI-local 斜杠命令；这些命令会出现在 `/help` 中，并在 TUI 内处理。 |

---

## 日志与终端画面

TUI 占用屏幕期间，会对看起来像 **JSON 结构一行一条** 的日志输出做过滤，避免打乱布局。退出后恢复正常的 stdout/stderr。

---

## 实现要点

- **网关：** 对话通过 `POST /api/sessions/:sessionKey/inputs` 写入持久化输入，通过 `POST /api/agent/resume` 附着到活动输出，并维持 `GET /api/events` 接收广播状态；会话与模型和网页控制台共用 REST。
- **嵌入式：** 消息经 `AgentService.processDirectStreaming`，事件来自智能体流（`token`、`thinking`、`tool_start`、`tool_end`、`error`、`result` 等）。
