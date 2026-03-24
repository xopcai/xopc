# Web 前端迁移计划（Lit `ui/` → React `web/`）

将网关控制台从 `ui/`（Lit）迁移到 `web/`（React + Vite + Tailwind v4）。设计规范见 [ui-design-system.md](./design/ui-design-system.md)。网关协议与 [ui/README.md](../ui/README.md) 保持一致。

## 目标

- **行为对齐**：Hash 路由、Token、REST（`Authorization: Bearer`）、后续 WebSocket/SSE 与现网一致。
- **构建**：生产输出仍为 `dist/gateway/static/root`（与 `ui` 互斥，择一构建）。
- **Electron**：Hash 与相对资源路径便于后续桌面壳嵌入。

## 阶段与状态

| 阶段 | 内容 | 状态 |
|------|------|------|
| **A** | Hash 路由、应用壳（侧栏 + 分组导航）、网关 URL/Token、`apiFetch` + 401、Token 弹窗、各页占位、旧版 Hash 兼容 | **已完成** |
| **B** | SSE（`/api/events`）、连接状态、`window` 自定义事件（与 `ui` 对齐） | **已完成** |
| **C** | 聊天：`POST /api/agent` 响应体 **SSE** 流式（非 WebSocket）、`MessageList`/`ChatComposer`、会话 CRUD、resume、`sessionWireToUiMessages`；附件 / 富工具 UI 可后续对齐 `ui` | **进行中（核心已通）** |
| **D** | 会话 / Cron / Skills / 日志 四页（SWR + API） | 待开始 |
| **E** | 设置六段（Agent、Providers、Models、Channels、Voice、Gateway） | 待开始 |
| **F** | 根 `build` 切换至 `web`、回归测试、废弃 `ui` | 待开始 |

## 技术映射

| `ui/` | `web/` |
|-------|--------|
| `navigation.ts` | `web/src/navigation/` |
| `utils/storage.ts`（`xopcbot.token` 等） | `web/src/lib/storage.ts` |
| `utils/api.ts` + `fetch` | `web/src/lib/fetch.ts`、`apiUrl()` |
| `core/store.ts` | Zustand 分域 |
| `xopcbot-app` 壳 | `AppShell` + `createHashRouter` |
| `ChatConnection` | `web/src/features/gateway/`（`GatewaySseConnection` + `GatewaySseBridge`） |
| `ChatPanel` | 待：`features/chat` |

## 路由约定（React Router）

- 默认：`/` → 重定向到 `/chat`。
- 聊天：`/chat`、`/chat/new`、`/chat/:sessionKey`（与 `getChatHash` / `parseChatHash` 对齐）。
- 管理：`/sessions`、`/cron`、`/skills`、`/logs`。
- 设置：`/settings/:section`（`agent` \| `providers` \| `models` \| `channels` \| `voice` \| `gateway`）。

旧版 Lit 曾使用 `#sessions` 等形式（无 `/`）；`web` 启动时会将常见旧 Hash 规范化为 `#/...`，减少书签失效。

### 聊天流式（阶段 C）

- **与 `ui` 一致**：发送消息使用 `POST /api/agent`，`Accept: text/event-stream`，在 **HTTP 响应体**上用 `ReadableStream` + `_consumeSSE` 解析 SSE 事件（`token`、`thinking`、`tool_*`、`result` 等）。**不是 WebSocket**。
- **另**：`GET /api/events`（阶段 B）用于网关广播；与单次对话的 agent SSE 是两条通道。

### SSE 与全局事件（阶段 B）

- 端点：`GET /api/events`（`EventSource`），可选 `?token=`，与 `ui` 一致。
- 订阅的命名事件：`connected`、`config.reload`、`channels.status`、`message.sent`、`session.updated`。
- 在 `window` 上派发的自定义事件名：将点号换为连字符（与 `ui` ChatPanel 一致），例如 `config.reload` → `config-reload`；`detail` 为 JSON 解析后的对象（解析失败则为原始字符串）。

## 参考文件

- 壳与路由：`ui/src/app.ts`、`ui/src/navigation.ts`
- 聊天：`ui/src/chat/`、`ui/README.md`（Gateway 事件表）
- API：`ui/src/utils/api.ts`、`ui/src/utils/url.ts`

---

_更新：随阶段推进维护「状态」列。_
