# Workflow 清除验收记录

日期：2026-10-23。依据：[实施计划](./workflow-removal-implementation-plan-2026-10-23.md)。

Workflow 产品与执行子系统已从当前源码、共享契约、新库 schema、本机默认数据库及各端界面移除。没有新增迁移、转换、兼容 API、旧值映射或隐藏 DAG 引擎。验收不等于全仓所有检查均通过；以下明确列出已验证范围和剩余限制。

## 实际删除范围

- 后端：删除 `src/workflows/`、`src/agent/workflow/`、两项 Workflow 工具、专属 Gateway handler/Host、Task 协调器、项目绑定、slash/TUI 命令及渠道进度模块。清除服务装配、配置策略、事件、权限、缓存、工具发现和提示词引用。
- 通用执行：普通 Task 输入使用 `task` 来源；通用委派使用 `subagent` 会话身份。保留后台 Task 文本不触发 slash 命令的安全边界。Connector 预检独立归属 Connector，不包含 Workflow 适配。
- 契约和存储：删除 Workflow executor/action/session/resource/attention 类型、关联字段、四张专属表、索引和相关 CHECK 值；清理既有初始化 SQL 中的专属语句。删除项目 operating view 中仅供 Workflow 使用的 running 列表。
- Web：删除图编辑器、定义/运行页、聊天卡片与预览、项目入口、设置、自动化动作和专属 locale。未知页面统一显示通用未找到页面，无专属旧地址处理。
- Android/iOS/HarmonyOS：删除仓库、模型、视图、请求、路由、恢复状态和资源引用，同步清理单元与设备测试夹具。
- 文档和分发：删除中英文产品说明、导航及专属 Skill，更新共享说明和架构图；清除旧 renderer、专属截图与过期模拟器 staging 副本。保留 GitHub Actions、OAuth、浏览器录制、电脑导航提示和 Task 依赖图。

## 数据库清除结果

目标仅为本机默认状态根目录 `~/.xopc`。先停止该实例的旧桌面/Gateway 写入，在隔离副本验证后执行一次性离线删除；清除脚本未进入产品代码，隔离数据库副本已删除。

删除 `workflow_events`、`workflow_context_snapshots`、`project_workflow_presets`、`workflow_runs`，以及 Session/AutomationRun 关联列、索引、TaskRun/HomeAttention 中的专属约束值。清除专属 durable namespace、配置 JSON 字段与 Agent workflows 目录。原有专属实体行数为零；全局默认配置中清除一处 workflows 字段。没有转换任何旧对象。

清除事务前后，无关表行数变化为零；`integrity_check = ok`，`foreign_key_check` 为零，最终 schema 内 Workflow 对象为零。清除后再次检查仍通过完整性与外键检查。此结论不涵盖未指定的远程部署或其他状态目录。

数据库结果已汇总于本节，一次性执行 JSON 不单独保留。

## 验收矩阵

| 编号 | 结果 | 证据和范围 |
| --- | --- | --- |
| A01 文件与依赖 | 通过 | 专属目录和注册删除；Node/Web 类型检查与构建通过 |
| A02 运行工具 | 通过 | 工具、目录、手册、slash/TUI 测试及符号扫描，无旧工具或 alias |
| A03 API 与事件 | 通过 | 真实认证 Gateway 的五组旧 GET 地址及 POST `/api/workflows/runs` 均为 JSON 404，无 SPA fallback；生产者/消费者删除 |
| A04 配置与契约 | 通过 | Workflow 字段与枚举删除；无转换或重新激活分支 |
| A05 新库初始化 | 通过 | 隔离空状态启动、schema 无专属对象断言、SQLite 完整性/外键测试 |
| A06 当前数据 | 通过（指定本机实例） | 专属对象与配置清除；无产品内清理器或迁移器 |
| A07 存储完整性 | 通过 | 数据库结果见上；doctor deep 检查 11 项通过，零失败 |
| A08 聊天与委派 | 通过已测范围 | 真实 Web 新建/发送/响应完成；委派、输入、会话、取消/reset 等既有自动化回归。实测模型为本地合成服务，不是付费模型能力评测 |
| A09 Task/Project | 通过已测范围 | 真实认证 API 创建 Agent Task，TaskRun 成功并生成回执，按 manual 策略进入 review；不把模型自述视为已验证业务证据。项目/依赖图由回归覆盖 |
| A10 Automation | 通过已测范围 | 真实 Agent Automation succeeded；其余现有动作、取消和调度由回归覆盖，没有为旧动作增加适配 |
| A11 Web | 通过已测范围 | 生产资源验证聊天、自动化、旧入口通用 404；验收页面 console error 为零。双语资源参与构建，未声称所有页面的双语/深浅主题人工遍历 |
| A12 三端移动 | 部分通过 | 见下方移动端结果；没有将 host/build 测试等同于三端联网真机全场景验收 |
| A13 CLI/TUI/渠道/桌面 | 通过已测范围 | 普通 CLI/TUI/渠道回归、桌面构建与运行依赖检查；未安装或发布新版本 |
| A14 文档和包 | 部分通过 | docs:check、包清单检查通过；文档站构建被 7 处原有设计文档链接阻断，见下 |
| A15 隐藏残留 | 通过 | 源码/schema/产物语义扫描；不保留兼容 endpoint、Workflow decoder、开关或改名 DAG |
| A16 工作区边界 | 通过 | 保留个人记忆并行改动；未 reset 工作区、提交远程或发布 |

## 检查结果

- Node `pnpm run typecheck`、Web `pnpm -C web run type-check`：通过。
- Node/Web 构建、`pnpm run release:check-package`：通过。
- 最终桌面本地打包：`pnpm run electron:package --config.mac.notarize=false` 通过，生成 ARM64 DMG/ZIP，ASAR 运行依赖检查通过。Node/Web/桌面 ASAR 中专属模块路径、工具名、服务与字段扫描零命中；旧 dev renderer 已删除。包未自动安装。
- iOS：原生构建通过；测试 104 项、17 个 suite 通过。
- HarmonyOS：`harmony:verify` 通过；host 122 文件/807 测试、附加 8 文件/59 测试、类型检查、Debug/Release 未签名 HAP、CodeLinter 零问题。没有可用 hdc 目标，联网设备验收未完成。
- Android：通过 gradle-run 管理包装器执行 `:app:assembleDebug :app:testDebugUnitTest`，回答 “Does the Android client compile and pass unit tests after removing Workflow?”：通过。设备测试见下。
- 最终全量 Vitest：1,656 文件通过、1 文件失败、3 文件跳过；10,718 测试通过、1 测试失败、14 测试跳过。唯一失败为下述 HEAD 基线已复现的工作簿预览测试。最后清理的导航/attention 夹具另行 9 项通过。
- `eslint src`：零错误、7 个未使用变量告警。Web lint 四项原有错误见下。
- Android 设备问题：“Do Android connected instrumentation tests pass after removing Workflow?”：否，308 项中 283 项通过、25 项失败；不计为通过。14 项由测试 Gateway 缺少 requestProofVersion 导致，其余涉及界面断言、布局或相机等待；代表性 HEAD 对照另记。
- HEAD 对照问题：“Are representative Android instrumentation failures also present at HEAD?”：是，选取的 Gateway 鉴权、欢迎布局、HTTP 链接确认、Task header 四项均在 HEAD 复现。仅证明代表性失败，未把全部 25 项标为原有问题。对照复用同版数学/图表静态资源，跳过其生成步骤；没有修改 HEAD 应用源码。
- gradle-run 已 finish，仅删除其包装器拥有的日志。隔离 HEAD 源码副本随后清除；测试模拟器恢复当前清理后的 APK。

## 已确认的原有检查问题

1. `attachment-preview-local-app.test.tsx` 的 “opens the already-loaded workbook through the Electron bridge” 找不到按钮。在原始 HEAD 的独立只读基线中复现；本次没有修改该实现或测试。
2. Web lint 在 `file-open-menu.test.tsx:56–59` 报四处不必要类型断言。原始 HEAD 基线复现，未修改该文件。
3. depcheck 报八个循环依赖；原始 HEAD 基线同样为八个，包含 Task research/result delivery、memory capture 和 extension/config 等共享路径。
4. docs:build 报七处死链接：`agent-plugins-compatibility.md` 的三处，以及中英文 `computer-use.md` 的各两处。目标文件存在，但位于 VitePress 既有 `srcExclude` 的 design 目录中。本次没有放宽链接检查或伪造通过。

这些问题没有通过关闭检查、删掉失败测试或改动验收阈值来掩盖。

## 运行验证证据

真实认证请求验证 `/health`、`/api/sessions`、`/api/tasks`、`/api/projects`、`/api/automations`、`/api/home` 返回 JSON 200；旧 `/api/workflows/definitions`、`runs`、`drafts`、`project-presets`、`stats` 返回 JSON 404，没有 HTML fallback。Task 的 run/receipt 均为 succeeded，但 verification 为 unverified，按 manual 策略进入 review；Agent Automation 为 succeeded。浏览器验证聊天发送与响应、自动化页面及旧地址的通用未找到页面，console error 为零。

结果已汇总至本报告，逐次执行 JSON 和开发截图不单独保留。

旧安装版桌面进程已停止，避免用旧代码重新创建删除的结构；新包没有自动安装。所有真实 API 写入验证使用隔离合成状态目录，不修改用户业务 Task 或 Automation。

桌面打包的默认脚本自动触发 Apple 公证上传，发现后停止该步骤，后续使用 `--config.mac.notarize=false` 仅本地打包。一次进程诊断意外把公证应用专用密码输出到工具记录；本文不保存该凭据，建议撤销该应用专用密码。没有公开发布版本或推送远程变更。

## 全仓历史兼容清理复核

本报告记录 Workflow 删除阶段；随后按用户确认扩大范围，移除了主系统历史版本兼容代码、旧数据库升级链和各端旧存储读取。最新范围、当前 v259 基线及各端结果见[全仓历史兼容清理验收](./legacy-removal-acceptance-2026-10-23.md)。
