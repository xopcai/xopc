# pi 工具能力对齐：实施记录

日期：2026-10-11。依赖：pi 1.1.0。

## 最终决策

采用 pi 已发布的公开能力，删除 xopc 出站 MCP runtime。无法通过现有公开 SDK 对齐的功能删除，不再等待上游 SDK 补丁，不维护 fork、私有路径导入或第二套 MCP 管理器。

## 实现

- `src/agent/mcp/native-mcp.ts` 只投影主机配置与密钥引用，输出公开 LoadedMcpConfig。
- `session-runner.ts` 安装 createMcpExtension、原生 ToolSearch 与 Codemode。连接、注册、调用、取消、重连、列表变更、资源和 OAuth 均由 pi 执行。
- 提示词通过公开 ResourceLoader.systemPrompt 设置，保留 pi 的结构化 MCP 服务摘要；已删除私有 forceSystemPrompt/rebuild hook 覆盖。
- xopc 现有 AgentSession pool 管理业务会话；退出时发送公开 extensionRunner 的 session_shutdown 事件，等待扩展完成清理。没有新的 MCP 专属池。
- Device、Extension、Memory 主机工具适配为 pi ToolDefinition，保留设备绑定、身份和权限。CLI、Composio 的业务网关保留。
- 插件 MCP 服务使用原生合法且有稳定散列的服务 ID，不保留旧 plugin/ 别名。
- 配置对齐 pi：stdio / Streamable HTTP、timeout 秒、oauth、exposure、toolExposure。
- Web 只管理配置和插件静态密钥；`xopc mcp list/login/logout` 通过 pi 的公开 main 入口提供诊断与 OAuth。

## 删除范围

自建 bundle-mcp-runtime、runtime manager、工具物化器、传输客户端、OAuth manager/store/provider/session、独立 Gateway MCP 客户端、MCP 外部网关 provider、插件 MCP 连接恢复、MCP 资源附件解析、MCP 健康文件和旧命名/策略辅助代码。

一并移除旧 SSE、Web OAuth/远程回调、独立能力探测、资源浏览/附件、新 MCP Prompts 管理、旧 MCP 策略 ID、专属只读认证和严格结果 schema 校验。旧配置字段明确不支持，不增加兼容分支。

原 MCP 下载网络保护仅用于插件包获取，已移到插件 source-http-fetch；不属于 MCP 执行。

## 保留的业务职责

SQLite 会话、消息路由、设备绑定、业务工具权限、嵌套审计、脚本预算、输出保留和主机配置编辑仍由 xopc 负责。入站 MCP server 继续使用官方 SDK。

pi 状态目录默认位于 xopc 的 state/pi。OAuth 凭据交给 pi；旧凭据文件不会被迁移或删除。CLI 配置投影为私有生成文件，xopc 配置是唯一权威来源。

## 验证契约

真实 stdio 与 Streamable HTTP 服务，公开 SDK 和生产 pooled runner 两条路径验证 deferred ToolSearch、直接调用、QuickJS 结构化响应、资源/模板、权限 hooks、列表变更、请求取消及会话关闭。原生 MCP 结果封装和输出校验行为按 pi 验证；不再将原先差异列为上线阻断。

最终本地验收结果：

- 全量回归：1,484 个测试文件通过，3 个文件跳过；8,878 项通过，12 项跳过。
- 真实 stdio/HTTP 的公开 SDK 与生产 runner MCP 契约：11 项通过；配置投影与原生 CLI 委托：6 项通过。
- 根与 Web 类型检查、声明构建、Codemode 评估脚本类型检查、修改文件 ESLint 和 Web lint 均通过。
- Node/Web 构建与 Electron Gateway server 构建通过。
- Node CLI Gateway 与 Electron Gateway 各自的 MCP、Device 冒烟均通过。MCP 冒烟包含真实原生 CLI list、认证路由、服务摘要、发现、结构化结果、取消、冷启动、目录变更与重连；Device 冒烟包含签名、绑定、调用、脚本、审计、重连及解绑。
- 文档检查和 git diff --check 通过。

全量回归中曾出现一次既有语音 WebSocket 测试的连接失败；单独复验通过，最终完整重跑也全部通过，未修改语音实现。本轮直接在 main 开发，未 commit、发布或部署，未修改用户凭据或真实服务配置。

## 运维与升级

配置例子、登录方式、删除功能和迁移要求见 [MCP](../../cli/mcp.md)。后续升级优先升级 pi 并运行契约与 Gateway 冒烟。若新公开 API 能恢复所需管理能力，可另行接入；不为已删除的旧行为增加长期兼容层。

参考：[pi MCP 文档](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md)、[公开 SDK 示例](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/examples/sdk/14-codemode-mcp.ts)。
