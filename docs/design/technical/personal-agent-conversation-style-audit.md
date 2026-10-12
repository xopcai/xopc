# Personal Agent 对话表达调查与优化建议

> 日期：2026-10-12。状态：提示词修复与旧指令迁移已实现；尚未修改运行中 Gateway 的设置或进行真实模型对照。
> 目标：保留快速首句、事实准确与任务可靠性，使闲聊和短追问具有自然的对话节奏。

## 已确认的证据

1. 截图中的两条“**结论：…**”在 SQLite 中都是主会话的原始 assistant 消息。对应内容未出现在后台 composer 的 reply_text 中。因此针对这两条消息，问题源于模型生成，不是 UI 追加前缀或后台改写。
2. 当前个人表达偏好为 balanced，未要求结论标签。当前保存的 Personal 指令约 18,402 字符，多处重复强调答案优先、结果优先、简洁和完成工作。
3. 修复前，`reply-style.ts` 第一条要求首句独立有用并优先给答案/判断；`communication.ts` 要求已完成工作优先给 result or conclusion。这些规则没有直接要求输出“结论：”，但叠加后可能强化报告式表达。因果强度需要模型对照试验确认。
4. 修复前的示例只有邮件结果与任务失败，均为工作交付场景；没有中文闲聊、日期追问、认可、承接话题等正向示例。
5. 截图中“看什么…”对应输入是“看。”，该回复 stopReason 为 aborted。截断是运行中止状态，不能据此诊断为分段渲染损坏。是否应该追问，应结合当时的话题与上一轮提供的选项判断。
6. 这些消息实际运行模型记录为 `openai-codex/gpt-5.5`，provider 为 `xopc-cloud`，thinking 为 off。配置入口使用 auto，不能将配置别名当成实际执行模型。模型是否加剧报告口吻尚无对照证据。
7. SOUL.md 没有结论式输出要求；仓库已有温暖、随语境表达的 persona 指引。继续堆叠“更温暖”的泛化形容词，未必能解决场景与格式选择的问题。

## 优化方向

### 1. 首句原则改为承接当前话语

保留“尽早输出”，将表达要求收敛为：

```text
Reply to what the user is saying now, in the voice of an attentive personal assistant.
Begin with a natural sentence that fits the exchange: an answer for a question,
a relevant observation for casual conversation, a brief acknowledgement when one is needed,
or a concrete intent before necessary work. Continue with useful content as it becomes available.

Use flowing, short paragraphs for ordinary conversation. Give a structured summary when
the user asks for a report, comparison, checklist, or conclusion. A useful first sentence
does not require an introductory label or a bold summary line.

Interpret short replies in the context of the previous exchange. An acknowledgement alone
does not request a new task, cancel existing work, or require a clarification question.
When the user accepts a clear offer to continue, continue that topic; when ambiguity would
change an action or its scope, ask one concise question. Respect explicit requests to stop.
```

约束落到“什么时候用什么表达”，不建立新的模型分类调用。主模型直接根据已有上下文选择，避免增加首句前的延迟。

不要把闲聊统一改成情绪安慰、称呼、笑话或反问；这些行为也可能形成新模板。用户要求严肃、简短或正式报告时，以请求为准。

### 2. 补充多样的中文对话示例

示例覆盖下列场景，事实部分使用假设数据并明确只示范表达：

| 输入/语境 | 应展示的表达行为 |
|---|---|
| 继续聊 AI 新闻 | 从一件有意思的事及其含义展开，不先宣布“可以聊” |
| 这些是什么时候的？ | 直接回答日期与必要时间差异，不复述整份新闻清单 |
| 嗯 / K / 好的 | 按语境简短接住或结束，不自动派发、取消、重新询问主题 |
| 上轮明确提供继续讲某条，用户说继续 | 接着讲所指话题，不要求重新提供对象 |
| 一个词无法确定外部操作对象 | 明确追问，不能为追求自然而猜测操作授权 |
| 帮我总结成三点 | 使用用户要求的结构，避免把“不用列表”变成全局禁令 |
| 证据不完整或任务失败 | 在相关内容处说明实际限制，避免每轮重复泛化免责声明 |

正向示例应分散覆盖不同开场、不同长度与不同语境，不形成新的固定句式。

### 3. 修复已有指令升级方式

`upgradePersonalInstructions()` 当前对许多规则采用“未包含新规则就追加”。如果只替换源码中的规则字符串，旧数据库中的原句会继续存在，造成新旧规则同时生效。

实现时：

- 用精确的旧版生成规则清单替换现有 answer/conclusion-first 规则与旧示例，再追加当前版本。
- 对旧例子和版本化规则进行幂等迁移，保留用户自己写的表达偏好、人格与授权约束。
- 通过已有 AgentCatalog 更新和 session-agent eviction 刷新缓存，不直接写生产 SQLite、不重置个人会话。
- 长期将产品生成的表达规则放到独立系统提示词区，将用户自定义 instructions 与产品规则分开，减少约 18KB 持久指令的累积与重复。

### 4. 同步主会话和后台回复

`buildPersonalReplyPrompt()` 已复用 `PERSONAL_REPLY_STYLE_RULES` 和示例，应继续保持唯一表达策略。后台结果需要组织事实和保留精确内容，但不能将每份结果都包装为汇报。

继续保留来源 URL 校验、部分失败、请求的列表/表格/原文以及附件投递。无需前端正则删除“结论”：这种处理会掩盖生成问题，并可能误删用户明确要求的结构或引用。

### 5. 用真实模型回放验证

固定真实执行模型、thinking、上下文、工具结果、温度等可控条件，对比现有与新提示词。直接问答、闲聊、多轮追问、短认可、继续、明确停止、正式总结和失败说明各至少覆盖多个变体。

评估：

- 闲聊中的固定标签与加粗开场频率。
- 不必要的追问、称呼和“我可以…”结尾频率。
- 是否承接上轮话题，是否只补充追问要求的信息。
- 事实、日期、限制及用户要求内容的保留。
- 首句可见耗时，不能用额外改写调用换自然度。

代码测试只能验证规则装配、旧指令迁移和幂等性；不能证明模型已经表现自然。不同自动路由模型的效果需分开报告，本调查尚未发起付费模型对照调用。

## 建议实施顺序

先收敛表达规则、补充中文示例和旧指令迁移，再做实际模型对照。保留既有流式展示；暂不新增温度调节、模型切换或第二次润色调用。

## 修复实现

- 主会话与后台 composer 继续共用同一表达策略，首句按当前问题与语境自然展开。普通对话避免固定结论标签；用户请求正式报告、对比或总结时仍保留所需结构。
- 新增中文闲聊、时间追问、短认可、明确继续、模糊外部操作、停止、三点总结和部分失败示例，均标明是有条件的假设案例。
- 更新新消息解释规则，明确包括认可和继续，避免把短回应仅归为澄清、换话题或取消。
- 旧生成规则和旧示例按完整行/块精确清理，包括重复副本；保留用户自定义偏好、引用的规则、人格文件以及任务可靠性要求。
- 沿用 Personal 初始化的 AgentCatalog 更新与会话 Agent 缓存失效，重复初始化不会持续追加规则或改变版本。运行新 Gateway 代码后，打开 Personal 页面可触发已有规则升级；本次没有直接修改生产 SQLite。
- 验证覆盖旧指令替换、幂等性、用户偏好与 SOUL 保留，以及主会话/后台提示词一致性。真实模型的自然度仍需要按上面的回放方案评估。

## 参考

[Claude 官方提示词指南](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)建议用相关、多样的示例引导语气与格式，并描述希望采用的表达方式。这是设计依据，不是当前 xopc 实际模型的质量保证。
