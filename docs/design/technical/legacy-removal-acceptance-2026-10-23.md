# 全仓历史兼容清理验收（2026-10-23）

> 2026-10-24 更新：本文记录清理当日的结果。旧库拒绝策略已被保留数据升级策略替代：新库直接初始化 v259，已安装 v202–v258 通过保留的 SQL 链备份后事务升级；详见 [存储架构](../storage-architecture.md)。

用户确认范围：**清除全仓历史版本兼容；保留当前协议和外部标准支持**。本次在 Workflow 删除基础上继续实施，不做数据转换、不增加旧值映射、不保留双读或旧入口。变更已落到源码与构建产物，本报告随本次清理代码提交保存；未发布或安装到系统应用。

## 删除范围与结果

| 范围 | 已完成删除或收紧 | 验收 |
| --- | --- | --- |
| Workflow | 执行器、工具、API、实时事件、CLI、配置、数据库对象、各端入口与产品文档 | 原阶段详见 [Workflow 验收](./workflow-removal-acceptance-2026-10-23.md)；本轮产物扫描无相关路径 |
| 主系统初始化 | Agent JSON 配置导入、IDENTITY.md 导入、旧 memory/provider/STT 配置改写、内置历史迁移注册 | Bootstrap 只初始化当前 catalog 并恢复当前目录任务 |
| SQLite | 218–259 历史迁移目录、发现器/执行器、跨版本备份入口、旧输入历史表和迁移标记表 | v259 单一当前 schema；旧版本或有数据的无版本库拒绝打开且不写入；新库、完整性、外键测试通过 |
| CLI / TUI | config 根级 --show/--validate、旧 API 导出别名、单参数 custom factory、reasoningLevel 配置接口别名 | 实际 CLI 拒绝旧参数；保留 config show/validate；TUI 和会话配置专项 12 项通过 |
| Gateway / 核心 | 旧认证密钥 body 接口、旧扩展 activation 路由、voicePatchMode、旧工具策略 ID、设备 proof 0 升级、无签名设备放行 | 当前精确策略和 requestProofVersion=1 必须满足；签名 HTTP、录音集成及 Personal Agent 专项通过 |
| Agent / Personal Agent | 旧提示词快照与自动升级、旧 transcript usage 补写、旧 evidence 修复、旧 agents 工具返回形状、JSON 回复解析、旧策略与取消回执回退 | 当前提示词直接生成，当前返回结构和证据校验生效；相关专项通过 |
| Web / Electron | LocalStorage 旧 token 导入、旧侧栏/快捷键存储转换、旧头像样式解码、旧 dictation 回退、跨 Gateway 草稿归属推断、旧 IndexedDB 升级 | Web 类型检查和 Node/Web 构建通过；Electron 主进程、服务器及扩展构建通过 |
| Android | 单 Gateway profile 导入、旧版草稿 secure-store 读取/转换 | Debug 构建、单元测试及 25 项网关/草稿模拟器测试通过；测试服务使用当前签名和完整任务读取契约 |
| HarmonyOS | 旧 profile/refresh key 导入、旧 annotation 标记转换、旧无语音文本解释、旧会话配置字段 | 807 项 host + 42 项补充测试通过；Debug/Release HAP 和 CodeLinter 通过 |
| iOS | 检查网络协议、存储与共享解析；保留当前消息文本/块内容协议 | 104 项原生测试通过 |
| 文档 | CLI 别名、旧 Agent 导入和数据库升级说明 | 当前架构文档说明 v259 直接初始化、旧库拒绝；docs:check 通过 |

## 本机默认数据库

对 `~/.xopc/xopc.db` 停止持有进程后执行直接清理，无产品内清理器或转换器：

- 删除 `application_migrations`（2 行）和 `composer_input_history_legacy`（0 行）。Workflow 数据清理沿用上一阶段验收。
- 重建 `devices` 的当前签名约束：默认值 1、仅允许 1；删除 Agent 选择来源允许 `legacy` 的约束。两表不存在不符合当前约束的旧记录，没有转换数据。
- 清理及约束重建均未改变其他业务表行数；`integrity_check=ok`、外键违规 0；schema 定义不含 Workflow 或 legacy。
- `doctor --deep`：12 通过、0 失败、3 警告、3 跳过。警告涉及现有运行环境，包括 Gateway 未启动/未作为系统服务安装。

数据库与检查结果汇总于本报告，逐次执行 JSON 不单独保留。本机数据结果不代表其他设备或远程实例已经清理。

## 保留项及理由

这些是当前能力，不是主系统历史版本兼容：

- 扩展 SDK 的迁移注册协议和框架仍作为当前第三方扩展 API；主系统内置转换器列表已删除。
- 外部 Claude/Codex MCP 配置、OAuth 标准元数据、OpenAI-compatible 服务、pi 当前消息内容格式及 Android 平台必要回调继续支持。
- PDF.js 的 `legacy/build` 是第三方 Node 渲染入口。MCP credential tombstone 用来阻止上游重新采用旧 URL 授权，不导入或转换该授权。
- 当前任务恢复、目录持久任务恢复、会话输入续接、原文修订审计、内容版本历史和正常备份继续保留。
- 数据库升级过程的历史执行主体审计枚举不是转换器；不新增相关执行路径。
- 历史设计/实施记录保留为审计材料，当前文档已明确被本轮结果取代。Git 历史未重写。

## 首次验收结果与限制（已由下节最终补验收覆盖）

| 检查 | 结果 |
| --- | --- |
| 根类型检查 / Web 类型检查 | 通过 |
| Node + Web build | 通过 |
| Electron build:artifacts / release:check-package | 通过；无上传或公证动作 |
| 全量回归 | 10660 通过、14 跳过、1 失败；失败为此前存在的工作簿 Electron 预览测试 |
| 最终 Personal/SQLite 专项 | 4 文件、11 项通过 |
| 最终 TUI/会话配置专项 | 3 文件、12 项通过 |
| 源码 lint | 0 错误；其他源码已有 6 项 unused 警告；本轮 Personal/SQLite 专项 0 警告 |
| Web lint | 既有 file-open-menu.tsx 第 56–59 行 4 项错误仍存在 |
| docs:check | 通过 |
| VitePress build | 既有 7 处死链接仍失败，位于 agent-plugins-compatibility 与中英文 computer-use；未放宽检查 |

本轮 Android 使用 gradle-run 管理器运行 `:app:assembleDebug :app:testDebugUnitTest`，问题 “Does Android build and pass unit tests with current-only storage?”：通过。运行定向 `:app:connectedDebugAndroidTest`，问题 “Do Android gateway and current-only draft device tests pass?”：25 项通过。已执行 finish，仅移除管理器拥有的日志。

首次验收未重跑 Android 全量设备套件；下节已补跑并通过。未执行鸿蒙真机界面验收；iOS 为 Simulator 原生测试。当前源码、dist 和 out 已更新，但旧 `/Applications/xopc.app` 未被安装覆盖并保持停止；未将本轮结果宣称为已部署版本。

## 最终补验收：剩余问题已全部修复

用户追加要求中的工作簿预览失败、Web lint 错误、文档死链接均已修复，Android 全量设备套件已补跑并通过。上述首次结果中的失败和未跑项由本节覆盖。

### 修复内容

- 工作簿预览测试从“更多”菜单点击当前系统应用打开入口，继续校验 Electron bridge 调用次数、文件名和原始字节，并检查菜单收起；没有恢复旧工具栏入口。
- 删除 file-open-menu 测试中四处多余的非空断言，保留每个打开操作的调用校验。
- 七处文档链接改为仓库工程记录链接，五个目标文件均存在于 origin/main；工程目录继续不发布到用户文档站，死链检查保持开启。
- Android 待确认输入卡片为底部浮动输入框预留空间，使重试按钮可见且可点击。
- Android 相机入口在缺少 CAMERA 权限时请求权限，授权后检查 Gateway/会话仍匹配再拍摄；拒绝不会创建临时输出。取消与拍摄回传集成测试使用已授权相机并验证原会话与附件快照。
- 音频加载或准备失败提示明确切回主线程，避免无 Looper 线程弹 Toast 崩溃；仍保留取消时资源清理。
- 更新当前预览组件标签、Agent 标题和实时输出断言；固定 Task header 操作不再尝试滚动。欢迎布局分别检查紧凑与宽裕高度对应的中心位置，未放宽容差。媒体消息长按使用其语义动作；HTTP 链接按未合并文字节点的实际字符范围点击，再校验可见确认与取消。

### 最终结果

| 检查 | 结果 |
| --- | --- |
| 完整 Vitest（test:all） | **1647 文件通过，10661 项通过，14 项跳过，0 失败** |
| 工作簿预览 / 打开菜单专项 | **17 项通过**，包含于上述全量结果 |
| Web lint | **0 错误、0 警告** |
| Web 类型检查 | **通过** |
| docs:build（含 docs:check、VitePress 严格死链检查） | **通过** |
| Android 全量 connectedDebugAndroidTest | **308 项通过、0 失败、0 错误、0 跳过**；API 35 / Android 15 模拟器；约 321 秒 |
| git diff --check | **通过** |

Android 首轮全量暴露 10 项失败；经过源码与测试检查、定向修复后，再次执行完整套件通过，没有跳过、禁用用例或降低断言强度。最终结果见上表；重复的逐类统计及检查 JSON 不单独保留。

gradle-run 管理器验证问题及最终回答：

1. “Does the complete Android device test suite pass after removing historical compatibility?”：通过，完整 `:app:connectedDebugAndroidTest` 308 项。
2. “Do the 10 failing Android UI contracts pass after focused fixes?”：通过；定向组合先通过 9 项，HTTP 单项随后通过，最后完整套件覆盖全部 10 项。
3. “Does the Android HTTP link open a visible confirmation dialog?”：通过，可见确认弹窗及取消已验证。

管理器已 finish，仅清理其拥有的日志；本轮模拟器已关闭。iOS、鸿蒙及 Node/Electron 构建沿用前阶段未变更部分的验证结果，本轮没有重新宣称真机 UI 或发布验收通过。代码、后续修复及本报告一并整理提交；未安装到用户系统应用、未发布。

## 0.0.411 升级启动回归修复（2026-10-23）

已安装用户报告启动错误 `unrecognized_keys: ["workflows"]`。此前验收主要覆盖已清理的本机状态与新安装；删除 Workflow 字段后，旧配置文件和 Agent catalog 持久 JSON 仍可能存在同名字段，直接严格解析会阻断桌面初始化。这是本次清理引入的回归。

按追加的“不能让老版本升级失败”要求，退役数据处理调整如下：

- Desktop 初始化与 Gateway/CLI 的文件读取统一通过配置快照读取器。先丢弃已有文件中的废弃 `workflows` 字段，校验当前配置及渠道配置后，再原子写回只删除该字段的原文数据；不灌入默认值或改写凭据。其他未知字段和无效当前配置继续报错且保持文件不变。
- 文件在异步校验期间被编辑时不覆盖新内容；清理写入失败时，使用已经通过校验的当前值继续启动，并记录失败。正常文件和再次启动不重复写入。
- Agent catalog 初始化在事务内删除 `agent_catalog_settings.defaults_json` 和 `agents.overrides_json` 中的废弃 Workflow 策略，再解析当前结构；保留其他配置、Agent 身份、修订号和时间戳。
- 当前写入 schema 和运行时仍不提供 Workflow 配置或执行能力。这是已安装数据的退役清理，不导入 Workflow 定义或将其转换为其他产品对象。

新增专项覆盖配置文件残留、catalog 残留、两者同时残留三种打包桌面初始化路径，验证 token、端口、Agent 能力、workspace 和重复启动；还覆盖读取期间并发编辑、写回失败、其他字段/渠道验证失败时不覆盖原文。专项 4 文件、22 项测试通过；全量 1649 文件通过、10676 项通过、14 项跳过、0 失败。类型检查、修改范围 lint、Node/Web 构建、Electron 构建产物、发布清单检查、docs:check 和差异检查均通过。

本轮针对已支持的当前数据库版本中残留的 Workflow 配置。未恢复更早数据库版本的历史升级链；新构建需发布/安装后，用户已有的 0.0.411 应用才会获得该修复。
