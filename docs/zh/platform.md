# 将 xopc 连接到 XOPC Platform

xopc 默认可以独立运行。连接 XOPC Cloud 或企业独立部署的 XOPC Platform 后，可以使用平台统一发布的服务和 outbound runtime 调度能力，但不会替换本地 xopc。

## 选择运行模式

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| `standalone` | 独立使用个人安装，并自行配置模型和服务 | 使用本地配置和显式环境变量，不依赖 Platform Discovery。 |
| `connected` | 使用 XOPC Cloud，或加入企业自己的平台 | 读取一份带版本的 Platform Discovery，只使用其中明确发布的能力与端点。 |

默认模式是 `standalone`。它不表示所有模型都必须在本地运行：你主动配置的云端模型仍会收到完成请求所需的上下文。数据边界见[模型与服务商](./models.md)。

连接平台不会自动上传本地 xopc 的 SQLite 数据库、Session、工作区文件、凭据或用户理解数据。除非某项独立功能被显式配置为向服务发送数据，否则这些内容仍由本地安装管理。

## 连接与检查

```bash
xopc platform connect https://console.xopc.ai
xopc platform status
xopc platform status --refresh
```

连接企业独立部署时，把 URL 换成企业平台对外的 Console URL。如果企业提供多个工作区，可以保存默认工作区：

```bash
xopc platform connect https://xopc.example.com --workspace workspace-id
```

连接命令会读取 `/.well-known/xopc-platform`，校验带版本的发现文档，再把它保存到当前 `xopc.json` 的 `platform` 字段。`status --refresh` 会重新校验并替换已保存的发现快照。刷新失败时，xopc 不会猜测或悄悄回退到未发布的企业端点。

恢复独立运行：

```bash
xopc platform disconnect
```

断开连接会移除当前 Platform Discovery 配置，但不会撤销远端 runtime 注册或删除远端凭据。设备退役或 Token 泄露时，管理员仍需在平台控制面撤销对应 runtime。

## Discovery 控制哪些能力

平台可以发布认证、模型、Store、Tunnel、Share、runtime fleet、realtime 和 A2A 端点。xopc 只采用通过契约校验且确实出现在发现文档中的端点。显式命令参数和受支持的环境变量仍然优先于发现值。

发现文档还声明协议版本和能力开关。只有端点但能力开关为 `false` 时，不会启用对应能力。未知或不合法的契约字段会直接校验失败，不会进入兼容逻辑。

A2A 是平台面向外部系统的网关能力。xopc 可以识别发现文档中的 `a2aApi` 和协议版本，但当前版本没有本地 `xopc a2a` 客户端命令。连接到平台的 xopc runtime 可以通过 runtime-fleet 协议执行平台调度的任务。

## 把当前安装注册为 runtime

企业管理员先在 XOPC Platform 创建 runtime 注册，并把一次性的 `xopc_rt_…` Token 交给部署人员。通过标准输入保存，避免出现在 Shell 历史中：

```bash
printf '%s' "$RUNTIME_TOKEN" | xopc platform runtime token set --stdin
xopc platform runtime heartbeat
```

Token 保存在 xopc 凭据存储中，不写入 `xopc.json`。部署系统也可以在进程启动时注入 `XOPC_PLATFORM_RUNTIME_TOKEN`。

`runtime heartbeat` 只用于验证身份并获取当前策略信息，不会启动后台 worker。正式部署的 worker 使用导出的 runtime adapter 租用命令、续租、响应取消，并按顺序上报终态事件。每个 runtime Token 都绑定独立身份，不应在多台安装之间共用。

## 安全与运维

- Cloud 和企业平台 URL 使用 HTTPS。
- Discovery 只保存公开路由元数据，不放置任何密钥。
- runtime Token 通过交互输入、标准输入、凭据存储或 Secret Manager 注入，不写入提交的配置文件。
- Token 泄露或设备退役后，在平台控制面撤销 runtime。
- 平台升级并修改端点后，运行 `xopc platform status --refresh`。
- 自动化脚本使用 `xopc platform status --json`；输出不会包含 runtime Token。

完整命令见 `xopc platform --help` 和 `xopc platform runtime --help`。
