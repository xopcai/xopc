# 模型与服务商

xopc 可以使用云端 API、OAuth 服务商、本地模型服务和自定义 OpenAI-compatible 接口。开始聊天前，至少配置一个服务商并选择默认模型。

## 查看当前安装支持什么

模型目录会随服务商和扩展变化。请使用实时列表，不要依赖容易过期的静态清单：

```bash
xopc providers list
xopc models list
xopc models status
```

桌面或网页控制台中，打开 **设置 → 能力 → 模型**。

## 选择模型

重点考虑四个因素：

| 因素 | 需要回答的问题 |
| --- | --- |
| 质量 | 能否稳定完成你的主要任务？ |
| 速度 | 响应时间是否适合交互使用？ |
| 成本 | 价格和使用限制是否可接受？ |
| 隐私 | 提示词、文件、图片和音频在哪里处理？ |

先选择一个通用模型。基础设置正常后，再添加专用或低成本模型。

## 连接云端服务商

使用模型设置页面，或运行：

```bash
xopc providers set-key <provider>
xopc models list --provider <provider>
xopc models set <provider>/<model>
xopc models status
```

支持浏览器登录的服务商：

```bash
xopc models auth login --provider <provider>
```

如果可以使用凭据存储、认证配置或环境变量，就不要把服务商密钥写进 `xopc.json`。

## 使用本地模型

1. 安装并启动 Ollama、LM Studio 或 vLLM 等受支持服务。
2. 确认运行 xopc 的电脑或容器可以访问它的 API。
3. 在模型设置中添加服务商或兼容接口。
4. 选择已经下载并正在提供服务的模型。
5. 发送一条简短聊天请求。

xopc 在 Docker 中运行时，`127.0.0.1` 指向容器本身，不是宿主机。请使用当前 Docker 环境支持的宿主机地址。

本地运行能提高对请求处理方式的控制，但模型文件、硬件需求和运行日志需要由你自己管理。

## 全局模型与固定意图

所有 Agent 默认继承 `agents.defaults.models.chat`：

```bash
xopc models set <provider>/<model>
```

需要任务专用模型时，只使用固定意图：`fast`、`reasoning`、`coding`、`review`、`vision`、`understanding`。没有配置某个意图时回退到 Chat 模型。Agent 只在确有必要时覆盖某个意图，不能创建任意名称的模型槽位。

## 验证与排障

```bash
xopc models status
xopc agent -m "请回复 OK，并说明当前模型。"
```

| 错误 | 常见原因 |
| --- | --- |
| 认证失败 | 凭据无效、过期或属于其它服务商 |
| 找不到模型 | 模型 ID 错误，或账号没有使用权限 |
| 限流或额度不足 | 服务商套餐、余额或请求频率限制 |
| 连接被拒绝 | 本地服务未启动或接口地址错误 |
| 终端正常但 Gateway 失败 | 环境、配置 Profile 或服务凭据不同 |

使用 `xopc logs tail` 查找服务商返回的第一个错误。求助时不要发布完整请求内容或凭据。
