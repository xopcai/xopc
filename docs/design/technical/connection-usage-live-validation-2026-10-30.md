# MCP / Plugin 使用推荐真实联调

验证日期：2026-10-30（Asia/Shanghai）。

## 环境与范围

使用独立状态目录和 loopback Gateway（18791），运行当前工作区的真实后端与生产 Web 构建。通过浏览器交换网关令牌、完成连接、点击推荐入口、发送预填请求，并观察实际模型流式回复。没有 mock HTTP、MCP 工具列表或模型回复。没有更改日常 Gateway（18790）的连接、插件或会话。

- MCP：[Context7 官方 HTTP MCP](https://context7.com/docs/installation)，`https://mcp.context7.com/mcp`。
- Plugin：[Anthropic 官方 skills marketplace](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/.claude-plugin/marketplace.json) 的 `document-skills`，固定提交 `ca45fc496a3436251f191354091d557da31c15b5`。
- 真实模型：MCP 对话使用 XOPC Cloud 标准模型；Plugin 对话使用 `xopc-cloud/openai-codex/gpt-6.1-sol`。

## 验证结果

| 流程 | 结果与证据 |
| --- | --- |
| 自定义 MCP 测试连接 | Context7 握手与工具发现成功，返回 `query-docs`、`resolve-library-id` 两个工具；保存前展示能力预览。 |
| MCP 保存后推荐入口 | 保存后显示已保存状态与使用推荐入口；点击后进入新的无项目对话，预填内容保留目标服务器 ID `mcp_context7_com`，没有自动发送。 |
| MCP 推荐生成 | 发送后模型实际发现该服务工具，给出版本迁移、报错排查、框架选型三个场景；每个场景包含示例请求和所需信息。回复明确说明推荐阶段未执行文档查询。 |
| MCP 推荐后的实际使用 | 在同一对话选择“最小可用示例”场景，请求只读查询 React `useEffect` 清理时机。执行记录包含 `mcp__mcp_context7_com__resolve_library_id` 和 `mcp__mcp_context7_com__query_docs`，两次调用成功；回复提供 React 文档依据和 TypeScript 示例，没有修改文件。 |
| 官方 Plugin 导入与启用 | inspect → 固定提交与 reviewHash → install → 页面完成启用。最终状态可用、无需账号授权，只包含 marketplace 声明的 `xlsx`、`docx`、`pptx`、`pdf` 四个技能，诊断为空。 |
| Plugin 能力说明 | 详情页推荐区域展示安装包内技能的真实描述；技能描述没有复制进导航 URL 或自动作为请求执行。 |
| Plugin 推荐进入对话 | 点击 `docx` 对应的“帮我了解这个用法”，进入新对话，目标 Plugin ID 与 `docx` 能力均保留；发送前可编辑草稿。 |
| Plugin 推荐生成 | 模型调用 `skill_view` 和 `skill_manage status`，使用确切名称 `document-skills-cddffa9a4d8c.docx`。回复给出 Word 报告、文档修改与统一排版、修订与批注审阅三个具体场景，分别列明输入信息和可直接发送的请求。 |

测试对话标识（均属于临时联调环境）：

- MCP：`792a8eb8-f89e-4cfa-8761-b0ccd3bfd1b0`。
- Plugin：`66e86d4e-4277-4725-ad51-58110d13d3f7`。

## 联调发现并修复

1. **marketplace 子集被扩大为整个仓库。** 没有独立 `plugin.json`、通过 marketplace 声明技能子集的 Claude 插件，原来会同时扫描默认 `skills/` 和显式技能目录。真实官方包因此加载未选择的技能，并出现重复技能及额外诊断。现在此类 entry 仅扫描声明的技能目录；独立插件 manifest 的原有默认目录行为保留。增加共享仓库、多技能、无关无效技能的回归用例。
2. **Plugin 推荐缺少技能说明。** 将校验时读取的技能描述传入 inventory API 和 Web 推荐区域，避免用户只能看到文件格式名称；描述仅作为界面资料展示。
3. **推荐容易混入全局能力。** 推荐请求现在明确限定当前服务的能力，避免把其他插件或全局工具计入目标服务。

## 校验与边界

- Agent Plugin 单元测试：12 个文件、60 项通过。
- 真实 Gateway Plugin HTTP 回归：1 项通过。
- Web 推荐与相关连接、插件、导航回归：33 个文件、169 项通过。
- 后端 TypeScript 检查、Web 生产构建及修改文件 lint 通过。
- 首轮 Plugin 验证到技能发现、就绪状态、推荐生成及对话流程；Word 文件实际交付验证见下方追加记录。
- 公共 Context7 本次无需额外凭据即可发现工具并完成查询；这不代表所有账号、网络或后续服务策略都无需授权。
- 临时 Gateway 在验证完成后停止，临时模型凭据副本随联调目录清理；日常 Gateway 保持运行。


## 追加验证 制作 Word 报告并下载打开

2026-10-30 继续通过真实浏览器完成推荐入口到成果交付。独立临时 Gateway 使用相同固定提交的官方 `document-skills`。本次 Git 拉取超时，改用 GitHub 连接器取回选定插件的 183 个文件，每个文件按官方 Git blob SHA 校验后安装；不是临时编造的插件或模拟工具。

### 实际执行与成果

1. 点击 Plugin 详情中 `docx` 的使用推荐，进入新对话 `af4be3bc-6ef7-4599-9867-40a7b2ce0eb3`。将预填用法请求改为实际制作报告，提供上一轮联调事实作为材料。
2. 模型读取确切技能 `document-skills-784e7accd5d5.docx`；在测试工作区安装 `docx` 依赖，生成构建脚本并实际写出 Word 文件。没有由验收助手另写一个替代 Word 文件。
3. 第一轮发现渲染缺字后，模型调整字体并重新生成。随后 GPT-6.1 Sol 两次返回服务过载，保留已有文件，切换到真实标准模型继续包结构、数字核对与 `publish_artifacts` 交付。此次包含人工续接和模型切换，不是无中断的全自动成功。
4. 通过聊天中的工作区成果链接打开内置 DOCX 预览，中文正文及三个表格可读。在“更多文件操作 → 下载”中触发真实浏览器下载事件，取得 `~/Downloads/connection-usage-weekly-report.docx`。
5. 下载文件和工作区原文件逐字节相同，大小 **12,681 bytes**，SHA-256 均为 `621d25ad355cf9781aeec4dd209bd9239d5bd4f9a12541296f080a3f95ace356`。打开桌面应用后再次校验，文件字节没有变化。
6. 将浏览器实际下载的副本在 macOS Pages 打开，成功显示中文、A4 两页、四个语义分节标题、三个表格、真实项目符号和动态页码。逐页检查没有缺字、重叠、截断、表格溢出或多余空白页。原生导出的两页图像也逐页检查通过。
7. 包完整性检查通过，ZIP 含 19 个部件且无损坏；材料中 `60 + 1 + 169 = 230`、两个 MCP 工具、四个插件技能等数字正确。报告保留生成时“Word 成果正在验收”的材料边界，没有提前改写为全部通过。

### 验证到的限制

- Web DOCX 预览未显示动态 `PAGE` / `NUMPAGES` 字段结果，页脚为“第 页 / 共 页”；下载后在 Pages 中正确显示“第 1 页 / 共 2 页”和“第 2 页 / 共 2 页”。正文与表格预览成功，但不能声称 Web 预览完全保真。
- 已按文档技能运行打包的 `render_docx.py`。无界面 LibreOffice / Poppler 图像链条中文缺字；对原生 PDF 进行 Poppler 栅格化时还报告 `Missing language pack for Adobe-GB1 mapping`。最终逐页排版判断采用 Pages 实际打开和原生逐页导出结果，没有据此改写或损坏 Word 原件。
- 测试期间没有运行新的源码回归套件；周报中的 230 项是上一轮真实联调记录的材料数字。

最终 Word 保留在浏览器实际下载位置。截图、两页核验图及精简收据存于本次本地验收证据目录；不将脚本、PDF 或测试文件作为用户成果交付。临时 Gateway 完成后停止并清理模型凭据副本，日常 Gateway 不变。
