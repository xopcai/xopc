# 网页（Web UI）通道

Web UI 是网关自带的浏览器聊天（静态文件随网关一起提供）。

## 启动网关

```bash
xopc gateway --port 18790
```

## 访问

在浏览器打开 `http://localhost:18790`（或你的自定义监听地址）。

## 功能

- ✅ 通过网关聊天（REST；agent 回复通过 `/api/agent` 的 **SSE** 流式返回）
- ✅ 会话管理（`#/sessions`）
- ✅ 设置（模型、网关 Token、语音等）
- ✅ 日志查看
- ✅ Cron 任务管理

## 侧栏：按通道过滤会话

侧栏会话列表可显示 **网页** / **Telegram** / **微信** / **飞书** / **钉钉** 会话：

- **网页** — 前端在 `GET /api/sessions` 返回结果上做客户端过滤。
- **其它通道** — `GET /api/sessions?channel=<id>`（如 `telegram`、`weixin`、`feishu`、`dingtalk`），匹配 `SessionMetadata.sourceChannel`。

