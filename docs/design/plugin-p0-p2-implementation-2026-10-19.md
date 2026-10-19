> 后续安装交互、全局 Agent 可用范围和多方式授权流程已更新，见 [安装与授权设计及验收](./plugin-install-authorization-2026-10-19.md)。本文保留此前阶段的实施记录。

# Plugin P0～P2 实施与验证记录

日期：2026-10-19。此记录保留最初的本地实施结果。后续已完成真实 Store 分发与完整产品验收，Store API 已部署、客户端尚未发布；以 [Store E2E 验收记录](./plugin-store-e2e-2026-10-19.md) 为最新状态。

## 交付结果

完成首个可用里程碑：用户自行导入常见 Codex / Claude 插件，查看实际兼容范围，完成资源准备、配置 / OAuth / 连接复用、工具检查、Agent 绑定，再进入任务草稿。沿用原有 Plugin Store、pi MCP、凭据及 Skill Runtime。

| 阶段 | 已实现 |
|---|---|
| P0 | 格式描述与适配版本、组件诊断、默认发现 / 声明路径、原包完整性、方言 fixtures |
| P1 | 两种隐藏清单、原 Portable 格式、Git 固定提交、marketplace 选择、目录 / ZIP、来源限定身份、Skill / MCP 导入、配置表单 |
| P2 | 持久化准备任务、恢复 / 取消 / 幂等、资源缓存与校验、可执行资源、原生 OAuth、显式连接复用、Agent / 可选工作目录绑定、候选升级及凭据隔离、任务入口 |

完整范围与操作方法见 [使用说明](../agent-plugins-compatibility.md)。

## 重要实现边界

- 原包不改写；派生清单、receipt、历史版本与准备任务由宿主管理。旧 Portable 身份和既有全局绑定语义保留。
- 同名 Codex / Claude 插件按来源区分。固定提交和实际 artifact hash 用于审阅，下载内容变化时不能沿用旧 reviewHash。
- Skill 与 MCP 在真实 Agent 投影前过滤。可选工作目录与 Agent 授予取交集，绑定变化使 Skill 来源版本失效。
- OAuth 执行、PKCE、回调与刷新仍由 pi 负责。仅修复动态 Plugin 连接无法进入现有授权流程的问题。
- 新版使用独立的凭据身份；旧版在候选版本准备失败时继续工作。API key 引用按端点 / 认证契约复用，候选配置不会覆写旧版密钥。
- 复用连接需要用户明确选择，端点及 OAuth 配置必须匹配。源连接变化会使引用失效；卸载不会删除其共享账号。
- 资源先校验后发布，独立版本副本通过包生命周期锁写入，避免卸载后准备任务重新发布资源。缓存引用由保留版本推导，独立副本不会污染其他插件。
- 程序、脚本及敏感配置不会由目录浏览触发。可执行资源进入执行能力审阅；工具检查才会启动已审阅的 MCP 命令。
- 尚不支持的 Hooks 会阻止包启用。Commands、Agents、平台应用及其他未适配组件不会被当成已完成运行适配。

## 验证方法

本轮相关回归共 49 个测试文件、301 项测试通过；核心与 Web 类型检查、本次修改的 ESLint、Node / 类型声明 / Web 构建均通过。构建后的 JavaScript 安装与绑定隔离 smoke 通过。下述浏览器流程也已实际通过；未运行整个仓库的 `test:all`。

### 自动化回归

覆盖范围：

1. Portable / Codex / Claude 清单、嵌套 Skill、marketplace-only 清单、归档包装、同名来源、路径边界和长名称。
2. 包内敏感字段引用、兼容授权配置、端点 / scope 变化、分版本密钥和凭据身份。
3. 准备任务持久化、中断恢复、owner、版本冲突、重复操作、卸载竞态、候选版本失败 / 取消。
4. 缓存复用、私人副本隔离、共享引用释放、资源摘要与执行能力审阅。
5. 实际认证 HTTP Gateway 和 lazy routes，包括原生 OAuth 本地 / 远程回调。
6. Codex / Claude 安装至实际 pi 工具调用；连接复用不重复登录，源连接变更后停止投影，删除插件不删除共享授权。
7. 下载可执行 MCP 资源后通过真实 stdio 协议发现并调用工具，工作目录不匹配时不投影。
8. Skill 管理、Workspace Runtime、CLI、既有 Store / Extension 兼容回归与安装界面交互。

真实 MCP 调用使用本地测试服务与确定性测试模型流，没有请求真实 LLM，也没有发送邮件或修改外部业务数据。POSIX 可执行资源 fixture 在 macOS / Linux 验证；Windows 没有在本机完成真机验收。

### 浏览器

`scripts/verify-plugin-setup-browser.mts` 使用真实界面、临时 Gateway / SQLite、本地 OAuth 服务，点击完成：

```text
检查来源 → 安装 → 下载 / 校验资源 → 检查工具
→ 刷新页面继续 → 浏览器授权 → 再检查
→ 选择 Main → 启用 → 验证 Other 无访问权限
```

同时检查桌面、375px 窄屏、深色横屏与 reduced-motion。截图位于本机 `/tmp/xopc-plugin-browser-evidence/`，运行结束关闭测试服务器并清理临时账号状态。

### 真实来源的静态核查

- 固定本地 OpenAI 样本：180 个包均可生成检查报告，识别出 574 个 Skill、154 个平台应用依赖包和 5 个可归一化的 MCP server。它们并未全部通过业务运行验收。
- 真实 Git 来源：`obra/superpowers`，提交 `bb92a77741419a4ab5f06e711a283343f1ada0c3`。完成固定提交获取与 marketplace 选择，识别 15 个 Skill、双清单及 Hook 不兼容。没有执行该仓库的 Hook 或业务任务。

## 支持范围之外

P3～P5 的 Commands / Agents / Hook Runtime、OpenAI 平台应用契约适配和精品业务验收继续按方案推进。复杂 marketplace overlay、npm / command 来源、MCPB / DXT、通用 Python / npm 环境管理器尚未加入；不会通过放宽校验或自动执行包脚本来假装兼容。

当前网页提供 Agent 选择，工作目录限制可通过 API / CLI 设置，并在详情展示。Native Extension 的宿主级服务、工具和 UI 机制继续保留。
