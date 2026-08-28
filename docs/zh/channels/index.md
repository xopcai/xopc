# 消息通道

消息通道让用户从其它应用与 xopc Agent 对话。请先确认本地聊天和 Gateway 正常，再配置通道。

## 可用通道

| 通道 | 设置方式 | 指南 |
| --- | --- | --- |
| Telegram | Bot Token | [Telegram](./telegram.md) |
| 微信 | 扫码登录 | [微信](./weixin.md) |
| 飞书 / Lark | 扫码创建应用或手动填写应用凭据 | [飞书](./feishu.md) |
| 网页控制台 | Gateway 地址和 Token | [网页控制台](./webui.md) |

扩展可以添加其它通道类型。

## 连接前准备

1. 确认本地聊天可以调用模型。
2. 让 Gateway 持续运行。
3. 决定谁可以发送私聊和群聊消息。
4. 从配对或白名单开始，不要默认开放。
5. 决定通道 Session 由哪个 Agent 处理。

## 配置与状态

<!-- 截图占位：/screenshots/channels.png -->

使用 Gateway 控制台的 **消息通道** 页面。终端中：

```bash
xopc channels list
xopc channels show <channel>
xopc channels enable <channel>
xopc gateway health
```

## 私聊访问策略

| 策略 | 行为 |
| --- | --- |
| 配对 | 未知用户收到验证码，需要所有者批准 |
| 白名单 | 只有名单内用户可以发消息，其它人被忽略 |
| 开放 | 所有人都可以发消息 |
| 停用 | 阻止私聊 |

推荐从配对开始。在通道设置中批准，或在 Gateway 主机运行：

```bash
xopc channels pairing approve <channel> <code> --account <account>
```

批准前核对发送者身份。获批用户可以把内容发送给配置的 Agent 和模型。

## 群聊访问

私人群组使用白名单。通道支持时要求提及机器人，避免它响应每一条消息。先在一个群中测试，再添加到其它群。

## 故障排查

- 本地聊天失败：先修复模型。
- 通道状态异常：检查凭据和 Gateway 日志。
- 机器人收不到消息：检查平台事件设置、群权限和访问策略。
- 消息进入错误 Agent：检查通道路由或默认 Agent。
- 配置已修改但行为未变化：重启 Gateway。
