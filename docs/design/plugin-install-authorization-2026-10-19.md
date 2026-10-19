# 插件安装、暂缓授权与详情页恢复

本轮在 P0–P2 实现上收敛交互，并扩展授权协议。安装默认对所有 Agent 可用；不再要求选择或绑定 Agent。此文替代早期方案中的安装期 Agent 绑定设计。

## 从 Accio 借鉴的交互

证据包括本轮提供的 12 张截图、此前通过 Computer Use 观察的安装流程，以及本机 Accio ASAR 的安装编排代码：`/tmp/xopc-accio-plugin-research/out/renderer/assets/plugin-install-dialog-CfPhtA-X.js`、`out/main/gateway-worker.js`。截图能证明可见状态与入口，不能单独证明第三方授权的后端实现。

| 观察 | xopc 的落地 |
|---|---|
| 初始化、CLI 安装、授权、加载工具分别展示 | 自动准备固定摘要资源，再按账号授权，最后加载通过检查的服务 |
| Token 有说明、官方链接和字段表单 | 声明字段及说明；密钥进入宿主凭据存储，安装包与 Job 只保存引用 |
| 飞书提供扫码与手动 App ID / Secret 两种方式 | 一个账号可声明多种方式，按需选择表单、OAuth 或 CLI |
| CLI 登录可返回网页或二维码挑战 | 执行已审阅的命令，消费受限 JSON Lines 挑战，展示 URL / 二维码，运行独立账号检查 |
| Skip for now 不撤销安装 | 单独保存 installed 与授权状态，保留资源和可用组件 |
| 未授权卡片有 Auth incomplete | 市场和已安装卡片显示“需要授权”，详情页按账号显示连接状态 |
| 详情页可以补授权 | 独立详情路由 `/capabilities/extensions/:pluginId`，重载后可以继续 |
| 安装结束还有 Agent 绑定 | 不采用；所有 Agent 全局可用，特殊配置归 Agent 设置 |

## 用户流程

1. 安装前审阅新增网络、下载与本机执行能力。
2. 宿主自动下载并校验资源。CLI 程序可随包交付或通过固定 SHA 资源交付，不通过安装向导隐式执行任意安装脚本。
3. 按账号展示授权说明与适合的方式：Token、Client Key / Secret、浏览器 OAuth、CLI URL 登录、CLI QR 登录。
4. 可以选择“暂时跳过”。安装完成后进入详情页，相关账号显示“需要授权”。没有授权的服务不进入 Agent 运行时；已通过检查的服务仍可用。
5. 用户从卡片进入详情，选择对应账号继续授权。表单保存后检查服务；OAuth / CLI 成功后自动重新检查。全部通过后清除提示。

资源失败、包完整性失败和不支持的 Hook 不允许通过跳过授权绕过。

## 状态与运行时

`PluginSetupJob` 分别保存安装状态、资源状态、缺失配置、账号方式及状态、服务发现结果。`defer` 是明确的用户动作，不伪造已连接状态。`installed=true` 使账号补授权期间仍可发布原先已连接的服务；每个服务仍须满足对应账号及实际发现检查。

| 场景 | 可见结果 | 运行时 |
|---|---|---|
| 缺少配置或账号 | 安装中，可暂时跳过 | 未就绪服务不可见 |
| 跳过授权 | 已安装 / 需要授权 | 只发布已检查的部分 |
| 无效 Token | 保留表单并显示检查失败 | 不发布对应服务 |
| 取消 / 过期登录 | 可重新连接 | 不把挑战页打开视为成功 |
| 完成部分账号 | 对应账号已连接，其余仍需授权 | 保留可用部分 |
| 全部通过 | 所有 Agent 可用 | 发布通过检查的服务 |
| 关闭或刷新详情 | 从持久状态恢复 | 不自动批准账号 |
| Gateway 停止、安装移除或版本变化 | 终止待完成 CLI 登录 | 完成的凭据保存在账号目录 / 原生存储 |

授权状态表示上次实际检查结果，并不承诺实时监测第三方的所有撤权事件；用户可以重新授权或重试检查。

## 插件声明

Codex / Claude 的基础包格式保持原样，扩展声明位于 `extensions["ai.xopc"].setup`，协议版本为 1。普通 MCP 插件不需要添加声明，继续使用宿主推导的 OAuth / API key 流程。

```json
{
  "extensions": {
    "ai.xopc": {
      "setup": {
        "version": 1,
        "authorizations": [{
          "id": "office",
          "title": "Office account",
          "servers": ["office"],
          "methods": [{
            "id": "manual",
            "title": "Client Key / Secret",
            "type": "form",
            "fields": ["clientKey", "clientSecret"],
            "instructions": ["Create an application and obtain its credentials."],
            "helpUrl": "https://example.com/developers"
          }, {
            "id": "scan",
            "title": "Scan QR code",
            "type": "cli",
            "login": { "command": "node", "args": ["${PLUGIN_RESOURCES}/office-cli", "login"] },
            "check": { "command": "node", "args": ["${PLUGIN_RESOURCES}/office-cli", "status"] },
            "timeoutSeconds": 300
          }]
        }]
      }
    }
  }
}
```

表单字段必须在 `userConfig` 中声明。账号字段按所选方式检查，避免要求扫码用户额外填写另一种方式的 Secret。字段通过既有 `user_config` 模板用于 MCP 的环境变量 / 请求头；表单不会根据字段名猜测第三方 API。

`oauth` 方式指定该账号关联的远程 MCP `server`，注册、PKCE、回调与刷新继续归原生 pi 管理。`form` 方式负责凭据配置和真实服务检查；它不隐式假定任意 Client Secret 都对应某种 OAuth 流程。需要额外应用注册或分阶段登录的提供方应通过自己的 CLI 适配器执行该流程。

CLI 不使用 shell；命令纳入能力审阅，程序路径遵循既有包路径 / 资源边界。进程不继承宿主 API key 环境，仅继承必要的运行环境和显式声明的凭据。每个账号的默认 HOME 隔离在插件的版本目录，MCP 可通过 `${PLUGIN_ACCOUNTS}/<account-id>` 访问相同目录。

登录程序在 stdout 输出 JSON Lines，例如：

```json
{"type":"challenge","kind":"qr","url":"https://provider.example/approve/session"}
```

也支持 `kind: "url"`。挑战只接受 HTTPS 或 loopback HTTP，输出有大小限制和超时。成功退出后仍必须执行 `check`，最后一行须为 `{"authenticated":true}`，然后宿主继续发现关联 MCP 工具。原始 stdout / stderr 不作为凭据或错误细节回传给页面。账号目录可以包含 CLI 自己的凭据，卸载时选择删除本地凭据会清理该插件拥有的目录。

## 验证资源

- Store: `xopc-plugin-auth-lab@1.0.0`；程序资源由 Store 的 SHA 内容寻址接口托管。
- 合成授权服务：`https://store.xopc.ai/plugin-auth-lab/`，独立于已有 OAuth Lab。
- Token：`lab-token`；Client Key / Secret：`lab-client` / `lab-secret`。这些仅是合成测试值。
- `scripts/verify-plugin-authorization-e2e.mts`：真实 Store、构建后的 Gateway 和 Web、跳过、列表提示、详情重载、错误凭据、四种方式、四个原生 MCP 工具调用、全局可用和窄屏布局。
- QR 验证通过生成真实挑战二维码并在浏览器完成同一挑战；不将它描述成已验证某个真实业务 App 的手机扫码或企业审批。

本轮客户端代码在工作区，未发布 npm 或桌面客户端版本。

## 本轮验收结果

- 18 个相关测试文件、73 项回归通过；核心 / Web 类型检查、相关 lint、Node / Web 构建通过。
- 真实 Store 多方式授权 E2E：17 项通过。包含同一账号由手动凭据切换到独立的扫码登录，补授权后实际执行四个 MCP 工具。
- Store 生命周期：19 组通过；普通 Codex OAuth 完整 Gateway 对话：13 项通过；Claude 浏览器安装及真实工具验证通过。
- 用户当前 Chrome 实际演示：安装测试插件、暂时跳过、进入详情、显示“需要授权”、切换手动 / 扫码方式、生成实际 CLI 挑战、再次跳过并保留补授权入口。
- [结果与截图](../../reports/plugin-install-auth-2026-10-19/verification.json)。真实业务账号未用于这套合成验收。
