# xopc 对话配置与使用：评测与实施报告

日期：2026-10-21。评测及改动范围：**main Agent**。源码基线：`c4e754d32`。

后续更新：本文保留第一轮 v3 的历史结果。当前实现已由[精简指引成对评测](conversational-setup-compact-evaluation-2026-10-21.md)替代：精简常驻规则＋主题 manual＋工具约束，去掉 main 身份限制。下文的“仅 main”“不新增 topic”等是第一轮时点决策，不是当前实现。

## 决策

选择 **main 系统提示词中的内置短指引 + 现有 xopc_use + 现有 manual**。不新增 Skill、工具、配置写接口或 manual topic。main 已注册 `xopc_use` 时才注入指引，其他 Agent 和个人 Agent 的提示词、工具权限不变。早先“优先补强 manual”的建议由真实评测结果替代。

这是当前场景集和模型下的最佳候选，不是所有模型、所有场景的普遍结论。本版本改善现有产品能力的使用准确性；完整语音配置、邮箱接入和持久 setup 流程仍需后端能力，不能靠指引凭空实现。

## 模型与真实执行条件

用户最初指定 `openai/gpt-5.5`。ChatGPT OAuth 服务端返回 400：该模型不支持当前登录方式。用户明确允许改用账户可用模型；GPT-5.4 也返回不支持，最终固定为 **`openai/gpt-5.6-sol`**，low thinking，每次请求最多 4096 输出 token。全组同模型，没有按结果换模型。模型目录存在不等于账户可调用。

正式比较使用生产 `buildSystemPrompt`（包含 Skill 选择规则）、真实 embedded turn、`xopc_use`、AgentCatalog、AutomationService 和 SQLite。每个样本新建子进程、合成数据库、配置及工作区，当前 Agent 固定 main；共享既有 credential store 和 refresh lock，不复制 refresh token。日常 xopc 数据没有重置或删除。

成对比较只注册产品工具、manual，以及 Skill 组需要的真实 `skill_view`，有意排除邮件、语音及文件直写工具。生产集成后另用真实 Gateway、认证 HTTP、session input 队列和 main 默认工具工厂验证，二者证据分开记录。

## 比较方案与样本

| 方案 | 内容交付方式 | 开发集读取 guide 次数 |
|---|---|---:|
| baseline | 原有工具说明、系统提示词及原 manual | 0 |
| manual | 同基线；增加实验 guide topic 与简短路由提示，按需读取 | 2 |
| skill | 同基线；真实 skill_view 读取临时 xopc-guide/SKILL.md | 11 |
| inline | 同基线；同一正文直接进入系统提示词 | 0 |

三组候选 guide 正文完全相同；Skill 使用生产读取及校验工具、隔离索引，不是伪造读取。manual topic 仅为评测 wrapper，未进入产品。按场景轮换执行顺序；先做 12 场景 × 4 组，再让前两组做 8 个留出表达 × 2 次，共 **80 个真实模型逻辑样本**。留出表达与开发场景同类但未用于调正文；不属于独立新领域测试。

| 类别 | 开发集 | 留出集 | 验收依据 |
|---|---|---|---|
| 创建助手 | D01 | — | 真正创建，保留语言／风格，无附加项目或默认切换 |
| 当前助手改名 | D02 | H01 | 持久名称正确，简介／语言／风格不丢失 |
| 当前助手模型 | D03 | H02 | 只改目标 Agent，全局及其他 Agent 不变 |
| 语音配置边界 | D04 | H03 | 正确语音入口，说明设备操作待完成，不伪造测试 |
| 能力检查 | D05 | — | 查询真实 Agent 数据，承认未验证能力 |
| 暂停自动化 | D06 | H04 | 暂停匹配对象，其他日程不变 |
| 保存关闭草稿 | D07 | H05 | 北京时间 09:00，正确 cron，enabled:false，无 run |
| Gmail 缺工具 | D08 | H07 | 说明连接及读取阻塞，不启用无依据的邮件自动化 |
| 普通写作／命名 | D09 | H08 | 直接回答，无产品调用或额外 guide 加载 |
| 并发版本冲突 | D10 | H06 | 注入真实冲突，重读、保留并发字段后修复 |
| 已有助手去重 | D11 | — | 无重复创建或修改 |
| 默认助手切换 | D12 | — | 使用目录 revision，只切换默认 |

以整场景全部断言通过且运行正常结束为成功；可避免的工具错误也判失败，不能只看最终“已完成”文案。D10/H06 的预期版本冲突不按普通错误计。模型设置用例保存的 GPT-5.5 是目标配置值，不代表实际调用过 GPT-5.5。

## 结果

| 方案 | 开发集原始评分 | 复核后通过 | 输入 token 中位数¹ | 耗时中位数¹ |
|---|---:|---:|---:|---:|
| baseline | 7/12 | 8/12 | 26,831 | 30.5 秒 |
| manual | 8/12 | 10/12 | 16,365 | 28.2 秒 |
| skill | 10/12 | 11/12 | 35,385 | 29.5 秒 |
| inline | 11/12 | **12/12** | 30,537 | 26.5 秒 |

| 留出复测 | 原始评分 | 复核后通过 | 输入 token 中位数¹ | 耗时中位数¹ |
|---|---:|---:|---:|---:|
| inline | 16/16 | **16/16** | 30,400 | 27.1 秒 |
| skill | 14/16 | 15/16 | 34,761 | 31.2 秒 |

¹ 每个完整样本的累计输入（含 cacheRead）和墙钟耗时，不是单轮上下文大小或服务 SLA；受缓存、网络及执行顺序影响，样本小，无显著性推断。manual 输入较少但 guide 只读了两次，关键规则常未进入上下文。

复核后的成对结果（左侧胜／负／平）：baseline 对 inline 为 **0/4/8**，manual 对 inline 为 **0/2/10**，skill 对 inline 为 **0/1/11**；留出 inline 对 skill 为 **1/0/15**。原始评分也把 inline 排第一，复核没有改变选型。

### 代表性一对一观察

| 用户目标 | 原方案或其他候选 | 内置指引 |
|---|---|---|
| 改名并保留配置 D02 | baseline/manual 先用仅有 name 的 profile 覆盖，随后补救且出现可避免 revision 错误；最终修好仍按过程失败 | 先读取，完整保留 profile 后更新，一次完成 |
| 开启语音 D04 | baseline 返回 overview，用户仍需寻找语音入口 | 返回 capabilities/voice；说明还需设备授权及真实测试 |
| Gmail 连接 D08/H07 | manual/skill 使用不存在的 connections 或 connected-apps 设置 section；传输成功但落到 overview | 说明缺少专用连接／读取工具，不虚构完成或设置入口 |
| 同时修改简介 D10 | baseline 最终状态正确，但耗尽 10 次模型调用的执行预算，outcome 非成功 | 读取新 revision，保留并发简介后完成授权改名 |
| 普通命名 H08 | 作为负例检查过度触发 | 两次均正常回答，无产品操作 |

所有失败 trace 和 paired 回答保留。需要继续改善的一点是语音回复仍可能泛化设置页按钮步骤；本次只验入口、能力边界及不伪造完成，没有验收这些具体按钮文案。

### 评分复核、重试与排除

原正则把“不能声称测试通过”“语音聊天：不可用”“回复‘已连接’”误判为完成。新增统一审计评分器识别否定和引用，并按真实前端路由补查 settings section；对所有组一致重算，原评分和原 trace 不覆盖。H07 中未来时的“确认读取成功”仍可能被保守正则扣分，但其不存在的 connected-apps 路由是独立、确定的失败依据。自动文案评分不是完整语义裁判。

开发集 48 个物理执行；留出集 32 个逻辑样本、35 个物理执行（inline 18、skill 17）。额外 3 次仅为**任何工具执行前**的网络／provider 瞬态失败重试；保留 attempt1/attempt2、累计 token 与耗时，不对产品错误、不确定写入或评分失败重跑。共 83 个正式物理执行。

早期网络／模型探测、缺失正常 Skill 选择段的探索 v1/v2、48 条无模型工具链自检均单列，不计正式结果。v2 发现实验提示词不完整后停止，重新冻结完整 v3 的全部组，未将探索成绩混入选型。

## 代码实现与边界

- [指引正文](../../../src/agent/prompt/conversational-configuration-guide.ts)：与胜出实验正文完全一致，涵盖对象范围、profile 替换、模型形状、导航边界、自动化、连接缺失、版本和幂等恢复。
- [生产注入点](../../../src/agent/prompt/service-prompt-builder.ts)：`agentId === 'main'` 且已注册 `xopc_use`，通过既有 extraSystemPrompt 接入；保留 profile、Skill 目录、交互状态及调用方提示。显式 none 模式不注入。
- [main 回归测试](../../../src/agent/prompt/__tests__/main-configuration-guidance.test.ts)：验证内容与实验一致、入口范围及上下文保持。
- `xopc_use` 继续负责动作，manual 继续负责完整参数；领域服务继续负责授权、revision、幂等和落盘。未增加权限、allowlist 或个人 Agent 行为。

## 生产链路验证

真实 Gateway 使用 main 默认工具（非产品工具白名单）、认证 HTTP、session input 队列和生产提示词运行，**4/4 通过**：

| 场景 | 真实链路验收结果 |
|---|---|
| main 改名 | SQLite 中名称保存为小舟，简介、语言、风格保留 |
| 自动化草稿 | 阅读提醒已创建；Asia/Shanghai 09:00；保持关闭，运行记录为零 |
| 语音入口 | 正确 capabilities/voice 链接；说明设备步骤待完成，不伪造测试 |
| 普通命名 | 输出三个名字，自动化数量不变 |

回执：`.xopc-evals/conversational-setup/main-gateway-selected-v1.json`。未带认证请求为 401。旧 Gateway 基线仅用于定位 overview 入口问题，非成对排名样本；其语音旧正则也有否定误报。

验证合计 **119 项测试通过**：25 项新增／评测回归，94 项现有 prompt 参数、基础提示词、xopc_use 及 tool_manual 回归。根 TypeScript、评测脚本 TypeScript、三个生产／测试改动文件 ESLint、git diff --check 均通过；scripts 被仓库 lint 忽略，不宣称 lint 覆盖。没有运行完整仓库测试或 Web／Electron 构建，代码未发布。

Gateway 用例回执写完后依赖仍保留空闲 timer，结束了已完成的探针进程，并在脚本落盘／关闭资源后显式退出；不是用中止掩盖未完成模型运行。测试只证明上述 main HTTP 链路与持久化断言，不包括浏览器渲染、麦克风、邮箱或 Electron。

## 复现与证据

运行协议：[README](../../../scripts/conversational-setup-evaluation/README.md)。运行器：[evaluate-conversational-setup.mts](../../../scripts/evaluate-conversational-setup.mts)；评分器及审计有独立回归测试。默认仍保留最初指定模型，复现本次需显式传 `--model openai/gpt-5.6-sol`，按网络环境配置 HTTP(S) proxy。

本地原始证据（.xopc-evals 被 Git 忽略，文档 JSON 保存汇总及 manifest）：

- 开发集：`.xopc-evals/conversational-setup/development-main-v3/{manifest,summary,audited-summary}.json`
- 留出集：`.xopc-evals/conversational-setup/holdout-main-v3/{manifest,summary,audited-summary}.json`
- 各目录内逐样本 trace、不可变 attempt、合成 state 路径及 frozen baseline-manual.md。
- 来源摘要覆盖 runner、cases、guide、关键工具和生产提示词模块；运行前后校验，变化时不输出排名。

机器可读汇总：[最终评测证据](conversational-setup-evaluation-2026-10-21.json)。

## 后续实施顺序与验收门槛

本次先完成现有能力的指引、成对实测与 main 生产接入。后续按[第一期设计方案](../conversational-setup-phase1-2026-10-21.md)逐层补能力，不将未实施部分写进可执行指南：

1. 上下文感知 capability inspect：复用 readiness、模型及诊断；新增当前身份／Agent／会话聚合。验收 ready、unknown、disabled 能区分，禁止仅凭凭证宣称可用。
2. 受控 voice preview/apply：复用现有配置、revision、目录及音频组件，提取共享领域服务和聊天内设备测试。验收权限拒绝／设备占用／重启后的 revision，以及真实录音识别和播放。
3. Gmail 连接到摘要：复用外部工具发现、连接等待与恢复，新增流程绑定；验收真实指定账号授权、一次读取摘要、取消和刷新恢复，不读取其他账号。
4. 持久 setup 协调与自动化衔接：复用现有自动化草稿／创建服务，新增步骤回执和账号绑定。验收中断续跑、幂等不重复、明确同意后才启用、真实首个运行结果。
5. 新能力上线再扩充 held-out 正向与故障集，并重跑 main 比较；当前语音／Gmail 缺工具样本不能冒充上述完整闭环通过。
