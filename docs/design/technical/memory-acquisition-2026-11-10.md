# 记忆主动采集与漏学修复

日期：2026-11-10。延续[工作记忆证据复核](./memory-evidence-review-2026-11-10.md)。本轮解决「有可用证据却未进入学习链路」和「独立选择分散在不同会话」的问题，复用现有 SQLite、持久化 worker、观察表和证据准入。

## 已实现

- **任务回执**：使用统一的私聊主人身份解析，兼容缺少显式 routing 字段的历史 webchat 会话。按允许的 workspace/project 范围先筛选再取每批至多 100 条；幂等处理失败、部分完成和成功回执。仍检查会话模式、写入权限、敏感内容和遗忘边界；记录 reported 执行结果，不把报告当成客观成功证明。
- **引用修复**：有效 JSON 中的工作候选若引用不存在或引文不匹配，也进入一次修复。复用解释器原有两次总尝试预算；只替换失败候选，保留有效候选，最终仍走原宿主准入。来源学习使用短别名并保留真实 chunk ID，支持同样的一次引用修复。修复失败不使无依据内容入库。
- **跨会话观察**：第一次局部选择只存带期限的原始观察，不生成偏好。后续相关选择到来时，在同 Agent、规范化工作目录、同 project 内，从最近至多 200 条观察中选取最多 6 份相关原文；重新读取原始 transcript、核对 hash、主人归属、遗忘／删除、会话及处理政策，参与原有模型解释。仍需两份独立主人证据，不能用重复粘贴凑数。跨会话证据只能支持相同 workspace/project 的低风险 observational preference/routine，不能扩大到 global、生成目标／规则或作为旧工作事实使用。
- **真实工具结果**：识别宿主持久化的 codemode-tool-result，工具验证不再因 custom entry 形式漏掉；任意 sandbox store 仍不充当工具验证。
- **已授权来源恢复**：只恢复显式 scanEnabled 的可访问账号，补齐旧来源的 sourceInstanceId 映射、缺失的后继调度和保留索引的 consent 绑定。尊重撤销、关闭、失败／暂停状态、字段过滤与 Agent 授权。work_assistance 与 personalization 分别控制工作知识和个人推断，不因开启其中一个而授权另一个。
- **任务稳定性**：学习 policy hash 只包含影响证据、权限、范围和模型路由的字段；网关端口、显示选项、人格名称和无关模型设置不再取消学习。权限与 understanding/chat 模型变化仍使旧任务失效。

配置位于 userContext.userModel.extraction：crossSessionObservations 默认 true，observationWindowDays 默认 30（1–90），maxObservationEvidence 默认 6（1–12）。观察复用既有 user_model_observations，不增加 schema/migration。原文占用现有字符／历史条数预算，不截断证据、不固定增加模型调用。

删除已形成的断言会清理关联观察并抑制原始选择的重放；遗忘操作也清理当前作用域的待形成观察。不对任意历史对话做新的无条件回填。旧任务回执和已授权索引由后台既有周期有界恢复；本次验证不启动生产回填、不修改个人数据库或账号扫描开关，运行中的旧进程需加载新代码后生效。

## Benchmark

入口 scripts/memory-acquisition-benchmark.mts；固定合成语料 evals/memory/acquisition-cases.json。每个案例在独立 SQLite 中对比 crossSessionObservations=false/true，使用实际配置的模型、持久化学习 worker、解析器、准入和执行上下文。第一轮结束后关闭并重新打开数据库，再在第二个 conversation 学习；检查断言 authority、scope、两份原始消息的 lineage 和新会话可用性。

7 个案例覆盖中文／英文短标题、举例顺序、重复粘贴、跨工作区、客户引文及临时选择，两个实验臂共 14 项。另有 3 项：真实模型输出后显式注入一次错误 ref、26 条 legacy routing 合成任务回执、已授权本地来源学习及撤销。错误 ref 是声明的故障注入，只测修复能力，不推断模型自然出错率。

```sh
XOPC_MEMORY_LIVE=1 \
XOPC_MEMORY_LIVE_MODEL=qwen-token-plan-cn/qwen3.8-max \
XOPC_MEMORY_REPORT=reports/memory/acquisition-qwen-max.json \
pnpm run eval:memory:acquisition

pnpm exec tsc --noEmit -p scripts/tsconfig.memory-live.json
```

可把模型引用换成已配置的 GPT；缺少凭据明确失败。仅共享凭据访问，使用临时数据库与合成内容，不克隆个人记忆。报告包含逐项结果、模型响应、调用 token／延迟／提供商计价和源码指纹；缺项、失败或测试期间相关源码变化均非零退出。自定义模型未配置价格时，报告的零估价不代表真实账单为零。原始报告留在忽略的 reports/memory/。

这是一套小样本采集组件对照，不测完整 Gateway 对话回答，也不能外推通用准确率。词法匹配可能漏掉不同措辞，模型仍可以弃权；当前策略优先约束误记和跨范围使用，未来需要更大语料和多次重放验证收益。

## 本次结果

Qwen 3.8 Max 当前源码重放：17/17 项通过，相关源码指纹无变化。三个跨会话模式在关闭观察积累时为 0/3，开启后为 3/3，均通过作用域、原始双消息出处及新会话执行上下文检查。四类负例在两个实验臂中均未形成个人断言；客户引文也未进入工作记忆。故障注入后用第二次真实模型调用修复错误引用并保留两项事实；26 条任务回执从旧 SQL 的 0 条可选变为全部处理，重复执行为 0；来源学习的两项可用知识在撤销后均不可用。

报告：reports/memory/acquisition-qwen-max-current.json。首次报告 acquisition-qwen-max.json 为 16/17：举例顺序输出使用 examples before the explanation，初版词法 rubric 仅接受先／first，未识别等价表达。检查原始输出及确定性 parser/repair 后补充 before／之前，并增加报告中所有实际断言及 routine 修复回归，完整重跑获得上述结果；首次失败报告仍保留，不计为通过。没有降低双证据、作用域、出处和可用性门槛。

工程验证：80 个相关测试文件的 591 项通过；追加 routine 修复回归通过，另 4 个维护／后台复核文件的 14 项通过，合计 606 项相关测试。Node/Electron 类型检查、benchmark 脚本类型检查、受影响源文件与测试 ESLint、Node 构建及 git diff --check 通过。docs:check 仍因既有 docs/cli.md 缺少 device-host 命令概览而失败；该文档和命令不在本轮改动中。
