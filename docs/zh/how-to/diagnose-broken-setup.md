# xopc 故障排查

先确定失败的入口，运行对应检查；如果需要求助，只分享已经脱敏的报告。

## 运行通用检查

```bash
xopc doctor
```

只有怀疑 Session 或数据库状态时才使用 `xopc doctor --deep`。排查远程访问或暴露配置时使用 `xopc doctor --security`。

## 模型没有回复

```bash
xopc providers list
xopc models status
xopc agent -m "请回复 OK"
```

常见原因包括密钥失效、模型名错误、服务商额度不足或网络不可达。使用 `xopc providers set-key <provider>` 重新配置凭据。

## 桌面或网页控制台打不开

```bash
xopc gateway status
xopc gateway health
```

Gateway 未运行时执行 `xopc gateway`。端口已占用时，停止其它进程或修改 `gateway.port`。不要为了绕过本地连接问题而直接把 Gateway 暴露到公网。

## 消息通道不回复

1. 确认本地聊天能够调用模型。
2. 运行 `xopc channels list` 和 `xopc channels show <channel>`。
3. 检查机器人或应用凭据，以及私聊和群聊策略。
4. 确认 Gateway 持续运行。
5. 阅读[消息通道](../channels/index.md)中的对应指南。

## 验证配置

```bash
xopc config path
xopc config validate
xopc config show
```

`config show` 会隐藏已识别的敏感值。配置验证错误通常会指出需要修正的字段。

## 查看最近日志

<!-- 截图占位：/screenshots/logs-filter.png -->

```bash
xopc logs tail
xopc logs query --limit 50
xopc logs stats
```

桌面或网页控制台中，打开 **设置 → 日志**，按失败时间筛选。优先查看一次请求中的第一个错误，后续错误通常只是连带结果。

## 准备安全的求助信息

请提供：

- 操作系统与 xopc 版本；
- 失败的具体操作或命令；
- `xopc doctor --json` 输出；
- 最少量的相关日志；
- 同一模型能否在本地聊天中工作。

分享前删除 API Key、OAuth Token、Gateway Token、机器人 Token、用户标识、私人消息和个人文件路径。
