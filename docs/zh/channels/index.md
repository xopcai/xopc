# 消息通道

xopc 可将助手接入 **Telegram**、**微信（Weixin）** 以及 **网关 Web 聊天**。若安装第三方扩展，还可能出现其它 `channels.<id>` 配置块。

所有通道相关设置都在 `~/.xopc/xopc.json`（或由 `XOPC_CONFIG` 指定的文件）的 **`channels`** 下。

## 概述

| 通道 | 状态 | 功能 |
|------|------|------|
| **Telegram** | ✅ | Bot Token 或多账号 JSON、流式、语音、文档 |
| **微信（Weixin）** | ✅ | 在网关所在机扫码登录、私聊策略、可选按账号 JSON |
| **飞书（Feishu / Lark）** | ✅ | Socket Mode / Webhook、卡片、文档/知识库/云盘工具（可选开） |
| **网页（Web UI）** | ✅ | 网关控制台内嵌聊天，与其它客户端共用 HTTP API |

## 分页

- [Telegram](./telegram.md)
- [微信（Weixin）](./weixin.md)
- [飞书（Feishu / Lark）](./feishu.md)
- [网页（Web UI）](./webui.md)

## 扩展与通道

其它通道类型若由扩展提供，同样使用 `channels.<id>`，具体字段以扩展说明为准。

一般只需配置 **`channels.telegram`** 或 **`channels.weixin`**，相关能力会随配置自动加载。若要 **禁止** 某个扩展 id，将其加入 **`extensions.disabled`**。

其它 CLI 命令与扩展加载的关系见 [扩展系统 — 何时加载扩展](../extensions.md#何时加载扩展)。

