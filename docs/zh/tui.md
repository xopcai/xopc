# 终端界面（`xopc tui`）

**`tui`** 命令会打开全屏终端对话界面，底层使用 [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui)。流式展示助手回复、工具调用与思考块，体验上接近网关网页聊天，但完全在终端内完成。

命令行参数与速查见 [CLI 命令参考 — tui](./cli.md#tui)。

---

## 两种运行方式

| 方式 | 参数 | 是否需要网关 | 适用场景 |
|------|------|----------------|----------|
| **网关模式** | 默认 | 需要已启动的 `xopc gateway` | 与 Web 控制台共用会话、连接远程网关、在 TUI 里列出会话/模型等 |
| **嵌入式** | `--local` | 不需要 | 仅用本机配置与工作区快速对话，不经过 HTTP |

---

## 网关模式（默认）

1. 先启动网关（见 [网关服务](./gateway.md)）。
2. 将 TUI 指到网关的根地址；若网关启用鉴权，需带上令牌：

```bash
xopc tui
xopc tui --url http://localhost:18790 --token <你的网关令牌>
```

命令内置的默认地址为 `http://localhost:3120`。若你配置里的 **`gateway.port`** 不同（项目里常见默认是 **18790**），请用 **`--url`** 显式指定。

查看或生成令牌：

```bash
xopc gateway token
```

---

## 嵌入式模式（`--local`）

在**进程内**运行 **`AgentService`**（与无 TUI 的 `agent` 命令同源）：读取 `xopc.json`、工作区与默认模型，**不**依赖网关进程。

```bash
xopc tui --local
```

**嵌入式模式下的限制：**

- 未接入会话列表、模型列表接口；`/sessions`、无参数的 `/model` / `/models` 会得到空列表或不可用提示；**`/model <id>`** 无法切换模型（未实现 PATCH）。
- 当前版本不会从磁盘拉取历史聊天记录。
- **`/reset`** 会重启嵌入式运行时，相当于清空本次内存态会话。

若要在 TUI 中切换会话与模型，建议使用 **网关模式**。

---

## 命令行参数

| 参数 | 说明 |
|------|------|
| `--url <url>` | 网关根 URL（不要带路径后缀）。 |
| `--token <token>` | 网关 `Authorization: Bearer` 令牌。 |
| `-s, --session <key>` | 会话键（省略时默认为 `cli:tui`）。 |
| `-m, --message <text>` | 连接成功后自动发送一条消息，界面保持打开。 |
| `--local` | 嵌入式模式（不连网关）。 |
| `--thinking <level>` | 思考等级覆盖，语义与网关 / `agent` 一致。 |

示例：

```bash
xopc tui -s telegram:dm:123456
xopc tui -m "帮我总结收件箱"
xopc tui --url http://192.168.1.10:18790 --token "$TOKEN"
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

| 命令 | 说明 |
|------|------|
| `/help` | 列出命令。 |
| `/model` | 带参数：设置会话模型（`provider/model`）。无参数：列出模型（**仅网关模式**）。 |
| `/models` | 同无参数的 `/model`。 |
| `/session <key>` | 切换会话并清空当前屏幕上的对话区。 |
| `/sessions` | 列出会话（**仅网关模式**）。 |
| `/new`、`/reset` | 必要时中止；`/reset` 还会在服务端重置会话（嵌入式下为重启本地 agent）。 |
| `/abort` | 中止当前运行。 |
| `/thinking` | 开关思考区显示（等同 **Ctrl+T**）。 |
| `/tools` | 开关工具块展开（等同 **Ctrl+O**）。 |
| `/status` | 显示连接与活动状态（**仅网关模式**）。 |
| `/exit`、`/quit` | 退出 TUI。 |

---

## 日志与终端画面

TUI 占用屏幕期间，会对看起来像 **JSON 结构一行一条** 的日志输出做过滤，避免打乱布局。退出后恢复正常的 stdout/stderr。

---

## 实现要点

- **网关：** 对话走 `POST /api/agent`（`Accept: text/event-stream`），并维持 `GET /api/events` 等广播类事件；会话与模型与网页控制台共用 REST（`/api/sessions`、`/api/models` 等）。
- **嵌入式：** 消息经 `AgentService.processDirectStreaming`，事件来自智能体流（`token`、`thinking`、`tool_start`、`tool_end`、`error`、`result` 等）。
