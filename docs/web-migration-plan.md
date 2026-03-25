# Web 前端（网关控制台）

网关控制台位于仓库根目录的 `web/`：**React + Vite + Tailwind v4**，生产构建输出到 `dist/gateway/static/root`，由网关静态托管。设计规范见 [ui-design-system.md](./design/ui-design-system.md)。

## 路由约定（React Router / hash）

- 默认：`/` → 重定向到 `/chat`。
- 聊天：`/chat`、`/chat/new`、`/chat/:sessionKey`。
- 管理：`/sessions`、`/cron`、`/skills`、`/logs`。
- 设置：`/settings/:section`（`agent` \| `providers` \| `models` \| `channels` \| `voice` \| `gateway`）。

旧版 Hash（如 `#sessions`）在启动时会规范化为 `#/...`，见 `web/src/lib/legacy-hash.ts`。

## 网关集成

- **REST**：`apiFetch` / `fetchJson`，`Authorization: Bearer <token>`（见 `web/src/lib/fetch.ts`）。
- **Agent 流式**：`POST /api/agent`，`Accept: text/event-stream`，响应体按 SSE 解析（见 `web/src/features/chat/`）。
- **广播**：`GET /api/events`（`EventSource`），事件名中的点号映射为 `window` 上的连字符事件（如 `config.reload` → `config-reload`）。

---

_历史说明：早期 Lit 实现已移除；本文档保留路由与协议约定。_
