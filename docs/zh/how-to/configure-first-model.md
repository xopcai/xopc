# 如何配置第一个模型

当 xopc 已安装、但 agent 还不能调用模型时使用本页。

## 1. 保存 provider key

API key 类型 provider 使用：

```bash
xopc providers set-key deepseek
```

命令会提示输入 key，终端不回显。脚本中也可以显式传入：

```bash
xopc providers set-key deepseek --key "$DEEPSEEK_API_KEY"
```

检查凭据状态：

```bash
xopc providers list
```

## 2. 选择模型

列出模型：

```bash
xopc models list --provider deepseek
```

设置默认模型：

```bash
xopc models set deepseek/deepseek-v4-flash
```

检查结果：

```bash
xopc models status
```

## 3. 本地试聊

```bash
xopc
```

如果模型调用失败：

```bash
xopc doctor
xopc logs tail
```

## 说明

- `xopc onboard --quick` 是同一流程的交互式向导。
- 支持 OAuth 的 provider 也可通过 `xopc models auth login --provider <id>` 管理。
- 主配置文件仍是 `~/.xopc/xopc.json`；凭据可能通过 auth profile 存储，而不是直接写 raw key。
