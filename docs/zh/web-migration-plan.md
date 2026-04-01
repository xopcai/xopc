# 网关控制台（Web UI）

**网关控制台**是 `web/` 包中的 React 单页应用（Vite、Tailwind CSS v4、基于 hash 的路由）。它与网关 HTTP API 一起由网关进程对外提供。

## 连接方式

| 方式 | 用途 |
|------|------|
| REST | 设置、会话、Cron、日志、配置等 |
| SSE | 代理流式输出（`POST /api/agent`，请求头 `Accept: text/event-stream`） |
| EventSource | 广播事件（`GET /api/events`，可选 `?token=`） |

认证使用网关令牌（见 `gateway` / `onboard` 相关文档）。

## 技术栈（摘要）

- React 19、React Router 7（`createHashRouter`）、Zustand、SWR、Lucide、按需使用 Radix UI

## 相关文档

- [UI 设计规范](/design/ui-design-system) — 控制台的设计令牌与布局
- [网关](/zh/gateway) — API 与进程管理
- [配置参考](/zh/configuration) — `config.json` 中的 `gateway` 一节

面向贡献者的说明见仓库根目录 [`AGENTS.md`](https://github.com/xopcai/xopcbot/blob/main/AGENTS.md) 中的 **Web UI** 章节。
