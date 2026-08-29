# 终端快速开始

这是从全新安装到第一次终端对话的最短路径。

## 1. 安装 xopc

macOS、Linux、WSL2 或 Termux：

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

如果已经安装 Node.js 22 或更高版本：

```bash
npm install -g @xopcai/xopc
```

Windows PowerShell：

```powershell
iex (irm https://xopc.ai/install.ps1)
```

确认命令可用：

```bash
xopc --version
```

## 2. 连接一个模型

运行简化设置向导：

```bash
xopc onboard --quick
```

选择一个服务商，输入凭据，然后选择模型。Gateway、消息通道、技能和额外 Agent 都可以稍后配置。

## 3. 开始聊天

```bash
xopc
```

发送一条测试消息：

```text
请回复“xopc 已就绪”，并告诉我你正在使用哪个模型。
```

按照 TUI 帮助中显示的按键退出。Session 会自动保存，之后可以用 `xopc resume` 恢复。

## 4. 从一件重要的事开始

告诉 xopc 一个真实方向，不要假设它已经认识你：

```text
这周我最想推进的一件事是 ____。
请只询问缺失的背景，帮我定义完成标准，
然后提出最小但可信的下一步。
```

任务需要时，助手可以使用已启用的工具和工作区。缺少权限或凭据时，它应先向你确认。对于建议长期保留的理解，请主动检查，而不是默认每条消息都应该被记住。

## 如果没有成功

```bash
xopc models status
xopc doctor
xopc logs tail
```

- 没有配置服务商：查看[配置模型](./how-to/configure-first-model.md)。
- 找不到 `xopc` 命令：打开新终端，并确认安装程序已将 xopc 加入 `PATH`。
- 模型拒绝请求：检查密钥、模型名、账号余额和网络连接。

下一步可以阅读[用户理解](./user-understanding.md)、[聊天与会话](./session.md)，或者运行 `xopc gateway` 打开浏览器控制台。
