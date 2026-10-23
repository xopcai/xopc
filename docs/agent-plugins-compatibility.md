> 安装、暂缓授权、扫码 / CLI / 表单和详情页恢复的新流程见 [授权与安装设计](https://github.com/xopcai/xopc/blob/main/docs/design/plugin-install-authorization-2026-10-19.md)。

# Codex / Claude 插件安装与准备

实现日期：2026-10-19。对应 [生态兼容方案的 P0～P2](https://github.com/xopcai/xopc/blob/main/docs/design/plugin-ecosystem-compatibility-and-setup.md)。本页描述当前实现范围，不代表所有上游插件都已通过业务任务验收。

## 使用流程

在能力中心的插件安装入口输入来源，检查兼容情况和新增能力，确认安装。随后自动准备资源，按需登录账号并检查工具。安装默认对所有 Agent 可用，特殊配置在 Agent 设置中调整。准备状态由 Gateway 保存，关闭窗口后可以继续。

同一 Gateway owner 的 CLI 与浏览器入口共享准备进度；浏览器重新登录后可以继续，设备身份仍相互隔离。Store 中的已安装包通过“管理”入口继续配置。

准备与执行发生在 **Gateway 所在机器**。远程 Gateway 使用的是远端目录、运行环境和凭据；安装界面的本地路径选择不能上传客户端文件。

包安装、功能就绪和场景验收是不同状态。未完成配置的服务不进入 Agent 运行时；部分启用需要明确确认，未就绪 MCP 保持停用。包含尚未支持的生命周期 Hook 的插件可以保存安装包，但不能启用。

安装默认对所有 Agent 可用，任务入口创建新对话草稿，不自动提交任务。

## 来源

支持以下来源：

```text
store:package-name@version
/absolute/path/to/plugin
/absolute/path/to/plugin.zip
https://example.com/plugin.zip
github:owner/repository
git+https://example.com/owner/repository.git
git+ssh://git@example.com/owner/repository.git
```

Git 与本地目录支持以下片段参数。命令行使用时给整个来源加引号：

```text
github:owner/repository#ref=v1.2.3&path=plugins/example
github:owner/marketplace#plugin=example
/absolute/path/to/marketplace#plugin=example
github:owner/repository#package=1
```

- `ref`：分支、标签或提交；最终提交记录在 receipt 中。
- `path`：仓库内子目录。
- `plugin`：marketplace 条目名；未选择时界面展示候选。
- `package=1`：直接解释仓库根插件，跳过该仓库的 marketplace。

支持 OpenAI `.agents/plugins/marketplace.json` 与 Claude `.claude-plugin/marketplace.json` 的常见本地条目，以及 GitHub、Git URL、Git 子目录条目。支持没有独立清单、由 Claude marketplace 提供清单的包，派生清单保存在宿主 receipt 中，原包不改写。

复杂 marketplace 组件 overlay、npm / command 来源、远程 JSON 目录、MCPB / DXT 等尚未适配的形式会报出不支持原因。可直接安装对应的受支持仓库、目录或归档。不会执行目录中声明的任意命令。

Git 获取使用隔离仓库，禁用 Hook、submodule 和包脚本；验证文件数量与大小后取得固定快照。当前拒绝 Git 符号链接与 submodule。SSH 使用宿主 SSH 环境；非交互 HTTPS 获取不读取全局 Git credential helper，私有来源优先使用已配置 SSH agent 的 SSH URL。

## 支持矩阵

| 能力 | 当前行为 |
|---|---|
| 通用根 `plugin.json` | 保留既有严格 schema 校验 |
| `.codex-plugin/plugin.json` | 支持常用元信息、组件路径与 MCP |
| `.claude-plugin/plugin.json` | 支持默认发现、Skill 路径、MCP 配置及 typed user config |
| Skills / 包内资源 | 保留文件原文；运行索引为第三方插件增加来源名称空间 |
| MCP stdio / Streamable HTTP | 投影到现有 pi，不启动第二套 MCP Runtime |
| API key | 宿主凭据引用；可在启用前配置 |
| 原生 OAuth | 复用 pi 的注册、PKCE、回调、存储和刷新 |
| 连接复用 | 用户显式选择已有原生连接；检查端点和 OAuth 配置，源连接变化后阻止旧引用 |
| 资源 | 摘要校验下载、平台 / 架构限制、缓存复用、按版本生成独立文件，可声明可执行文件 |
| Agent 可用范围 | 默认全局可用；特殊设置归各 Agent 自身 |
| 工作目录限制 | CLI 可选；不参与安装期 Agent 选择 |
| Commands / Agents / LSP 等 | 保留兼容诊断，当前不执行 |
| Hooks | 当前不执行，阻止整个包启用，避免跳过保护逻辑后继续工作 |
| OpenAI 应用声明 | 标为需要平台适配；不会从 app ID 猜测公共 API 或继承其他应用登录 |

同时包含两种隐藏清单时，当前选择 Codex 方言，并明确报告未应用独立 Claude 清单。根通用清单优先；损坏的根清单不会回退到其他格式来绕过验证。

OpenAI MCP 认证扩展只映射 pi 可以表达的子集。公共客户端、受支持的自动注册与明确的默认 scope 可映射；私有客户端认证方式、显式端点覆盖等需要额外适配时会保留诊断，不静默按默认 OAuth 运行。

连接复用目前面向由原生连接配置流程建立、持有宿主 OAuth credential ID 的连接。不会复制 Codex / Claude 的账号缓存，也不会把同品牌、不同端点或不同 OAuth scope 的连接自动合并。

## CLI

```bash
xopc extensions inspect 'github:owner/repository#plugin=example' --json
xopc extensions install 'github:owner/repository#plugin=example'
xopc extensions setup plugin:<returned-id> --prepare
xopc extensions setup plugin:<returned-id> --authorize <server-name>
xopc mcp login <printed-public-server-id>
xopc extensions setup plugin:<returned-id> --prepare --complete
```

`--authorize` 输出适用的原生登录命令；登录交给 `xopc mcp login` 完成，再重新准备 / 检查。工具公开名称保持稳定，CLI 会将登录操作路由到正确的私有凭据身份。

其他用法：

```bash
xopc extensions setup plugin:<id>
xopc extensions setup plugin:<id> --config-file ./plugin-config.json --prepare
xopc extensions setup plugin:<id> --prepare --complete --workspace /absolute/project
xopc extensions setup plugin:<id> --prepare --complete --allow-partial
xopc extensions setup plugin:<id> --cancel
xopc mcp list --agent main --json
```

CLI 安装默认不启用。`--allow-partial` 不会绕过 Hook 不兼容、包篡改或资源校验失败。插件对所有 Agent 全局可用，安装不需要选择 Agent。

## 配置与资源声明

Claude `userConfig` 支持 string / number / boolean、required、default 与 sensitive。使用 `${user_config.KEY}` 引用。敏感值保存到宿主凭据系统，包内和安装任务只保存引用；敏感值应占据完整的 header / env 值。暂不将敏感字段插入命令参数或 shell 字符串。

资源使用既有 `ai.xopc` 扩展名称空间。`setup.version` 当前为 1，省略时按 1 解释：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "example-tool",
  "extensions": {
    "ai.xopc": {
      "setup": {
        "version": 1,
        "resources": [
          {
            "id": "tool",
            "url": "https://example.com/releases/tool",
            "sha256": "<replace-with-the-real-64-character-sha256>",
            "maxBytes": 10485760,
            "executable": true,
            "platform": "darwin",
            "arch": "arm64"
          }
        ]
      }
    }
  }
}
```

对应 MCP 可使用 `command: "${PLUGIN_RESOURCES}/tool"`，或通过解释器参数引用已下载的脚本。可执行资源单独加入执行能力审阅。安装器不会自动运行下载文件、解包脚本或任意包管理器生命周期脚本；工具检查才会启动已审阅的 MCP 命令。

每项资源默认 / 最大 50 MiB，最多 20 项。省略 `executable` 时为普通文件；省略平台和架构时不限制。下载不自动跟随重定向，须提供可以直接获取的地址。

缓存按 SHA-256 校验，每个插件 revision 使用独立副本。宿主从保留的当前、暂存与历史版本推导引用，卸载 / 取消暂存时回收无引用缓存。不会用硬链接让一个插件改动另一个插件的资源。

通用 npm / Python 环境管理器不在本版中新增。现有 Native Extension / Connector 的托管运行机制继续保留；第三方 stdio 命令所需的系统运行环境必须可用。若命令本身是 `npx` 等启动器，其获取和执行行为属于已审阅的命令，界面可展开查看原始执行内容。

## 准备、恢复与升级

安装任务保存在 `plugin-setup/<id>.json`，记录 owner、包 revision、任务 revision、步骤结果与幂等操作键。OAuth URL、code、token 和输入密钥不写入任务文件。

准备操作返回运行中的任务，界面查询进度。关闭窗口不取消任务；明确取消才停止后续步骤。进程中断后任务进入可恢复状态；失效的 OAuth 会话需要重新登录。并发操作使用版本检查和文件锁。

更新先保存候选版本，准备完成后才切换当前版本。下载、授权或工具检查失败时继续使用旧版。API key 配置与 OAuth 身份按 revision 隔离，候选版本切换账号不会修改旧版账号。兼容的 API key 引用可继续沿用；新 OAuth 身份按需要重新登录或显式复用已有连接。

新增执行能力、进程配置变化以及本地执行包内容变化都需要重新审阅。回滚保留当前启用状态与显式工作目录范围，重新投影实际可用的能力，不回滚业务数据。

卸载默认保留数据和凭据；可选择删除本地凭据。删除插件自己的 OAuth 身份不会删除明确复用的共享账号，也不代表已在供应商处撤销授权。

## 验证

相关回归覆盖格式 / 来源、名称冲突、凭据隔离、缓存引用、工作目录范围、安装任务恢复与幂等、真实认证 Gateway 的 lazy routes、OAuth 本地 / 远程回调、连接复用及实际 pi 工具调用。

浏览器流程验证：

```bash
pnpm run test:plugins:browser
# 使用机器上已安装的 Chrome：
XOPC_PLUGIN_SMOKE_BROWSER_CHANNEL=chrome pnpm run test:plugins:browser
```

脚本从真实 Store 安装 Plugin Lab，下载 Store 上的程序和数据，使用公开的合成账号 OAuth / MCP 服务，实际点击资源准备、配置、刷新继续、浏览器授权和全局启用，并通过 pi 调用工具。检查桌面、375px 窄屏、深色横屏及 reduced-motion，不使用真实业务账号。

完整多场景命令：`XOPC_PLUGIN_SMOKE_BROWSER_CHANNEL=chrome pnpm run test:plugins:e2e`。它先构建 Node / Web，再验证两种 Plugin 的 Store 安装 / 升级 / 回滚 / 凭据清理、原生 Extension、真实 Gateway 进程和完整 Web 页面。详见 [Store E2E 验收记录](https://github.com/xopcai/xopc/blob/main/docs/design/plugin-store-e2e-2026-10-19.md)。

固定 OpenAI 本地样本与真实 Superpowers Git 来源的静态检查，用于识别格式和兼容边界，不作为这些插件已通过真实业务场景验收的证据。


## 按授权启用 Skill 和 MCP

宿主在 Skill 来源合并、MCP 配置投影处使用同一份能力访问决策。插件已安装不代表需要账号的能力可用。账号待登录、跳过授权、过期、撤销、权限不足或检查失败时，对应 Skill 和 MCP 不进入 Agent；无需授权的本地能力仍可用。管理页面继续展示安装内容和补授权入口。

插件在 `extensions["ai.xopc"].setup.capabilityAccess` 声明依赖，宿主不识别厂商名称或业务权限：

```json
{
  "skills": {
    "local-analysis": {},
    "notes": { "authorizations": ["office"] },
    "calendar": { "authorizations": [{ "id": "office", "scopes": ["calendar:read"] }] }
  },
  "mcp": {
    "local": {},
    "office": { "authorizations": [{ "id": "office", "scopes": [] }] }
  }
}
```

- Skill 键使用包内原始名称，MCP 键使用清单中的服务名称。未知账号、Skill 或服务引用阻止插件启用；依赖声明进入安装审核指纹。
- `authorizations` 引用 `setup.authorizations`；`servers` 可声明连接依赖，例如无独立账号声明的原生 OAuth MCP。多个依赖均须满足。
- 空规则 `{}` 表示无需账号依赖。MCP 仍须通过自身连接检查，不会因为空规则而跳过检查。
- 字符串账号引用要求该账号无未解决权限问题。对象引用只检查列出的权限；`scopes: []` 要求身份有效，但允许与此能力无关的已知权限问题。没有具体 scopes 的未知权限问题仍阻止能力。
- 未声明规则的 Skill 默认依赖所有声明的账号；没有账号声明时依赖所有需要授权的 MCP。未声明规则的 MCP 默认依赖管理它的账号，否则依赖插件内全部账号。混合本地/远程插件应显式为本地能力写 `{}`。
- 没有账号声明的 HTTP MCP 默认需要授权；公开服务需声明 `connectionAuth.mode: "none"`。stdio 服务引用 sensitive user config 时按私有连接处理。

账号检查命令可返回可选的 `expiresAt`（Unix 毫秒）；宿主不添加厂商专属有效期。凭据实际是否有效、缺少哪些 scopes 由插件检查命令或原生 MCP 探测判定。每轮对话创建运行环境前，复查已安装插件的已连接账号和连接，不自动发起登录，也不重新下载资源；授权变化后重建 Agent 能力配置。检查失败不会保留此前的私有访问证据。

时间过期也会使 Skill 缓存和 Agent 缓存失效。撤销在下一轮检查时生效，不删除历史对话中已出现的文本，也不承诺中断已在执行中的外部调用。准备状态损坏或属于其他安装版本时不能授予私有能力。配置/登录使用的管理通道可探测尚未授权的服务，但不暴露为 Agent 工具。
