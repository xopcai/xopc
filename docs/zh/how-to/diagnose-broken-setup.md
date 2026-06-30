# 如何诊断损坏的设置

当 xopc 已安装但聊天、gateway、模型或 channel 不工作时使用本页。

## 1. 运行 doctor

```bash
xopc doctor
```

怀疑 session 或数据库状态时运行深度检查：

```bash
xopc doctor --deep
```

排查 gateway 暴露风险：

```bash
xopc doctor --security
```

## 2. 检查 gateway

```bash
xopc gateway status
xopc gateway health
```

如果 gateway 不在默认 URL：

```bash
xopc gateway status --url http://127.0.0.1:18790 --token "$XOPC_GATEWAY_TOKEN"
```

## 3. 检查模型凭据

```bash
xopc providers list
xopc models status
```

缺少 provider key 时：

```bash
xopc providers set-key <provider>
```

## 4. 查看日志

```bash
xopc logs tail
xopc logs query --limit 50
xopc logs stats
```

## 5. 校验配置

```bash
xopc config validate
xopc config show
```

提交问题时，请包含失败命令、`xopc doctor --json` 和相关日志行。不要公开 API keys、gateway tokens 或 bot tokens。
