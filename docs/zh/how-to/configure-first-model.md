# 配置第一个模型

先连接一个模型服务商并验证真实回复，再启用 xopc 的其它功能。

## 选择服务商

已经拥有账号或 API Key，并希望直接使用托管模型时，选择云端服务商。希望请求留在自己的电脑上，并且能够自行运行模型时，选择 Ollama 或其它本地模型服务。

支持的认证方式和本地服务配置见[模型与服务商](../models.md)。

## 使用桌面或网页控制台

<!-- 截图占位：/screenshots/model-setup.png -->

1. 打开模型设置提示，或进入 **设置 → 能力 → 模型**。
2. 选择服务商。
3. 使用 OAuth 登录，或者输入页面要求的 API Key。
4. 选择默认模型。
5. 保存，然后打开 **聊天** 发送测试消息。

聊天可以正常回复，并且模型页面显示服务商已配置，就表示连接成功。

## 使用终端

引导式配置：

```bash
xopc onboard --quick
```

手动配置时，先保存凭据，再选择模型：

```bash
xopc providers set-key <provider>
xopc models list --provider <provider>
xopc models set <provider>/<model>
xopc models status
```

支持浏览器登录的服务商可以运行：

```bash
xopc models auth login --provider <provider>
```

密钥输入提示不会回显内容。在共享电脑上避免使用 `--key` 参数，因为命令历史或进程工具可能暴露它。

## 验证

```bash
xopc agent -m "请回复‘xopc 已就绪’，并说明当前模型。"
```

如果失败，按以下顺序检查：

1. `xopc providers list` 是否显示服务商已配置。
2. `xopc models status` 是否显示预期的默认模型。
3. 当前账号是否有该模型的权限、额度或余额。
4. 网络是否可以访问服务商。
5. `xopc logs tail` 中是否有认证失败或找不到模型的错误。

凭据可能保存在认证配置中，而不是直接写进 `xopc.json`。请使用 xopc 命令或界面更新，不要把真实密钥复制进配置示例。
