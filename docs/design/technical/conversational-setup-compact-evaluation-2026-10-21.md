# 对话配置指引精简：成对评测及实施报告

日期：2026-10-21。状态：完成比较及代码集成，未发布。主要实测 Agent：main；补充 coder 范围验证。

## 决策与结果

采用 **精简常驻规则＋按需主题 manual＋工具约束**。不再用 `agentId === 'main'` 决定是否获得指南；依据运行时最终注册的 `xopc_use` 工具注入，沿用已有 allowlist、deny、执行策略和 capability 授权检查。指南不是权限来源，也没有新建 Agent 资源 ACL。

最终 v5 共 **64 个真实模型样本，两组各 32/32 通过**，原始评分均通过，无语义复核改分。精简版累计输入 token 从 **555,242 降至 484,248，减少 12.8%**。主要是减少上下文，请求数 116 对 114，耗时没有一致改善。小样本的同分不构成总体非劣效证明。

先行 v4 的“每次配置先读主题手册”虽然缩短首轮，但累计输入反增 4.4%，因此没有采用。其 24 个开发样本、一次无工具调用前的网络重试、原始评分、复核及源代码快照全部保留，未混入 v5 成绩。本次两轮共 88 个成对逻辑样本、89 个物理执行；另列真实 Gateway 验收及失败探针。

## 比较条件与证据边界

full 使用第一轮完整 candidateGuide；compact v5 将当前身份、操作范围、安全 profile patch、冲突处理、事实核验等作为常驻规则，已知操作可直接执行；流程或参数不清楚时读取 agent、settings、automation、connections 主题。普通写作不读取指南。

两组使用**相同的新工具描述、主题手册、设置入口校验和局部 profile 更新**，控制后端差异。这是在相同改进后工具条件下对比两种指南，不是原样重跑历史 v3 产品环境。[第一轮报告](conversational-setup-evaluation-2026-10-21.md)只作历史证据。

模型固定 `openai/gpt-5.6-sol`，沿用用户授权的可调用替代模型；low thinking、每次请求最多 4096 输出 token，最多 10 次模型请求。每个样本新建隔离进程、工作区及 SQLite，复用原 credential store 和 refresh lock，不复制 refresh token，不修改日常数据。

成对测试注册产品工具和 manual，刻意不提供真实邮件、音频和存储写工具。实际 Gateway 则使用 main/coder 默认工具另做验收。**12.8% 是该成对工具集合的实测值，不能直接宣称生产完整工具集合或所有长会话也节省同样比例。**

## 公共工具约束和手册

| 改动 | 行为及复用边界 |
|---|---|
| 设置入口验证 | 在共享 contract 中校验已知 settings section 和扩展路由形状，未知入口返回错误，不再制造成功链接；扩展路径形状合法不代表扩展已安装 |
| 安全局部更新 | 新增 `agent patch_profile {id,expectedRevision,patch,idempotencyKey?}`，在领域事务内合并顶层 profile，保留省略字段；复用既有 revision、幂等和授权机制 |
| 兼容旧接口 | 原 `agent update` 对 profile 的完整替换语义保留，没有改动现有客户端的替换约定 |
| 主题 manual | `tool_manual` 可选 agent/settings/automation/connections topic；省略仍返回完整参数手册，其他工具手册仍可照常读取 |
| 按实际工具开放 | xopc_use 被 allowlist/deny 排除时不注入指南；manual 不可用时保留核心规则，去掉对缺失工具的调用指引 |

没有新增 HTTP 路由。新 capability 通过既有 operations 路由和 lazy bundle 暴露，已在认证 Gateway 中实际调用并验证幂等重放和非法 section 拒绝。

## 冻结协议与通过门槛

[协议](../../../scripts/conversational-setup-evaluation/COMPACT_PROTOCOL.md)、候选正文、样本和评分器在每轮运行前冻结，前后验证源码 hash，保存快照。v5：main 开发集 12×2=24；main 回归表达 8×2次×2组=32；coder 范围 4×2=8。

H 表达此前已用于 v3，因此是固定回归集，不声称新盲测。S 范围用例在本次比较前新增。每个样本保留失败，按场景轮换组别顺序，模型并发不超过 3。仅任何工具调用前的瞬态 provider/网络错误可新进程重试一次，保留 attempt 并累计开销；不自动重放产品错误或不确定写入。

先比较整场景通过数，质量相同时比较完整任务累计输入及其中位数；越界、字段丢失、越权写入或假完成均阻止采用精简版。对未操作 Agent 和全局配置做完整快照比较。新增 patch_profile 按同一目标效果归一到原范围断言，不降低字段保留标准。

## 成对结果与 token

| 数据集 | full 通过 | compact 通过 | full 累计输入¹ | compact 累计输入¹ | 减少 |
|---|---:|---:|---:|---:|---:|
| main 开发集 | 12/12 | 12/12 | 217,117 | 187,723 | 13.5% |
| main 重复回归 | 16/16 | 16/16 | 255,158 | 226,987 | 11.0% |
| coder 范围 | 4/4 | 4/4 | 82,967 | 69,538 | 16.2% |
| 合计 | **32/32** | **32/32** | **555,242** | **484,248** | **12.8%** |

¹ API 实际返回的 input＋cacheRead，跨完整任务累计，不是单次 prompt 长度。总计少 70,994 输入 token；非缓存输入 509,290 对 441,752，减少 13.3%；缓存输入 45,952 对 42,496；输出 7,579 对 7,666，略增加。模型请求数 116 对 114。未计算 ChatGPT 账户账单或声称等比例费用、额度下降。

| main 开销观察 | full | compact | 解释 |
|---|---:|---:|---|
| 指南正文字符数 | 3,749 | 1,026 | 减少 72.6%，字符不是 token |
| 完整 system prompt 字符中位数 | 14,279 | 11,556 | 减少 19.1%，其余基础提示保留 |
| 开发集输入 token 中位数 | 19,458 | 17,244 | 减少 11.4% |
| 回归集输入 token 中位数 | 19,426 | 17,280 | 减少 11.0% |
| 普通改写 D09，一次请求 | 4,115 | 3,576 | 内容相同、无工具调用，少 539 输入 token |
| 开发集耗时中位数 | 29.2 秒 | 29.7 秒 | 无加速证据 |
| 回归集耗时中位数 | 27.0 秒 | 27.6 秒 | 无加速证据 |

所有 32 对按当前断言均平局。选择精简版依据是相同已测效果下的累计输入下降，不是“它比完整指引更聪明”。缓存、网络、模型随机性和工具发现均影响结果，不做显著性或 SLA 推断。

### 为什么 v4 没采用

v4 要求每个配置任务先读主题。复核后两组均 12/12，但 compact 累计输入 214,614，对照 205,583，增加 4.39%；模型请求 51 对 43。首轮少约 600 token，抵不过额外手册调用和后续上下文。

v4 full 原始 11/12 中唯一失败是“验证读取成功后……”的未来计划被判当前完成；回复明确说明当前无法读取且未启用。恢复为 12/12 的复核只作用于语言断言，原评分、trace hash 和理由独立保存。v5 最终比较没有这类改分。

## 典型一对一记录

| 用户目标 | full 实际链路 | compact 实际链路 | 累计输入 full → compact |
|---|---|---|---:|
| D02 改名且保留配置 | agent 主题 → get → patch_profile → get | get → patch_profile → get | 24,423 → 16,764 |
| D04 语音入口及测试边界 | settings 主题 → 正确语音入口，说明录音未测 | 同样正确；仍按需读 settings | 13,207 → 11,618 |
| D07 保存关闭提醒 | automation 主题 → list → create，正确时区、关闭、无 run | 同样行为 | 19,458 → 17,343 |
| D10 并发改简介再改名 | get → 完整 update 冲突 → get → 保留新简介后 update → get | get → patch_profile 冲突 → get → patch_profile → get | 30,023 → 26,370 |
| D09 普通改写 | 直接回答，无产品操作 | 同样行为 | 4,115 → 3,576 |

结论是让安全原语承接高频细节，手册保留参数和复杂流程；不是完全不读 manual。compact 开发集仍有 8 个样本读取主题，回归 8 个，coder 范围 1 个。

## 其他 Agent 的范围与权限

| coder 用例 | 两组结果 | 证据 |
|---|---|---|
| S01 “改你自己的名字，不动 main” | 均通过 | 目标为 coder，保留简介／语言／风格，main 完整快照不变 |
| S02 “只改 coder 聊天模型” | 均通过 | coder 保存目标引用，main、全局和默认 Agent 不变 |
| S03 “明确改 main，不改你自己” | 均通过 | 有授权时只改 main，coder 完整快照不变 |
| S04 系统拒绝修改 main | 均通过 | 真实 authorize 回调拒绝 patch_profile，持久数据未改；Agent 明确说未完成，无替代接口绕过 |

S04 是实际 capability 授权拒绝，不是只在用户文本里声称没权限。生产工具工厂测试另验证 main/coder 相同 allowlist、deny 优先和工具不可达；profile patch 的 dryRun、重放同样检查授权。

没有新增按 Agent 身份隔离的资源 ACL。宿主未提供细粒度回调时沿用现有授权策略；去掉 main 硬编码不等于给任意 Agent 自动授予管理权限。

S02 的 GPT-5.5 仅是保存的目标引用，实际评测始终调用 GPT-5.6-sol。回复仍有“ready”措辞，指 Agent 目录状态，不证明该模型可调用；这是仍需加强的表达边界。

## 真实 Gateway 验收及复核

通过真实认证 HTTP、session input 队列、生产 SystemPromptBuilder／工具工厂和 SQLite 验证以下 **6 个逻辑场景**：

| 场景 | 结果 |
|---|---|
| main 默认工具改名 | 保存名称且保留简介、语言、风格 |
| main 默认工具保存自动化草稿 | Asia/Shanghai 09:00，保持关闭，运行记录为零 |
| main 默认工具语音请求 | 返回正确语音入口，明确麦克风未验证；实际生成语音附件，不等于录音／可听播放通过 |
| main 默认工具普通命名 | 正常回答，自动化数量不变 |
| coder 默认工具改名 | 只改 coder，main 完整快照不变 |
| coder 仅 xopc_use、无 manual | 核心指引不要求调用缺失工具，改名成功且 main 不变 |

同时实际检查未认证请求 401、profile patch 的 HTTP 调用与幂等重放、非法 settings section 返回 400。

两次初始 coder 探针在任何模型工具执行前遇到 Connection error，transcript 中 input/output 均为零；保留原回执后各重试一次成功。Gateway 启动会补齐 specialistProfile 等元数据，范围快照改为启动后、输入执行前采集，避免把宿主初始化误算成 Agent 操作。这只修正验收脚本，不修改产品权限或行为。

main 原始脚本在 voice 处因“只有实际拿到录音结果才会判定测试通过”“若能听清……再视为录音测试通过”误报而停止。逐条复核确认没有当前录音通过声明；同一 transcript 的 text_to_speech 回执确认为 xopc-cloud MP3 附件生成成功。因此只在独立 reviewed 回执修正 noFalseTest，原始 failed 回执保留；未调度的 negative 场景另跑成功，没有重放已有工具写入以换取更好的回答。

生成附件不证明用户听到了声音；没有验收麦克风、真实 Gmail 账号、浏览器渲染或 Electron。真实 Gateway 的默认工具集合比成对测试更大，此处验收效果，不据此外推 12.8% 成本比例。

## 最终代码与验证

- [常驻规则与无 manual 降级](../../../src/agent/prompt/conversational-configuration-guide.ts)：正文与冻结 v5 compact 一致。
- [注入点](../../../src/agent/prompt/service-prompt-builder.ts)：按最终工具集合开放，没有 main 身份条件。
- [主题手册](../../../src/agent/tool-manuals/xopc-configuration.ts)、[读取工具](../../../src/agent/tools/tool-manual-tool.ts)：复杂参数按需读取。
- [profile 领域原语](../../../src/agent-catalog/capabilities.ts)、[xopc_use 适配](../../../src/agent/tools/xopc-use-tool.ts)、[设置契约](../../../packages/gateway-contract/src/capabilities.ts)：约束由工具及领域服务执行。
- [成对运行器](../../../scripts/evaluate-compact-configuration.mts)、[汇总与复核](../../../scripts/summarize-compact-configuration.mts)、[Gateway 验收](../../../scripts/verify-conversational-main-gateway.mts)。

13 个相关测试文件 **165 项通过**。根 TypeScript、评测脚本 TypeScript、受 ESLint 覆盖的生产及测试改动文件、git diff --check 均通过。没有运行全仓测试、Web/Electron 构建或发布。

gateway-contract 独立 TypeScript 检查仍在未修改的 `sessions-backend-contract.test.ts:65` 报 `SessionListItem.usage` 缺失；本次未混入无关修复。ESLint 不覆盖 scripts 和该 package，未将忽略当作通过。

## 仍需加强

1. **设置与测试状态应结构化区分**：导航建议、已保存、Agent ready、模型实测成功、设备测试成功不能共用“已配置好了”的概念；目前文字仍可能混淆 ready 或“打开入口”。
2. **设备步骤缺少 UI 证据**：有的回答仍泛化录音／播放按钮，即使入口正确、未假称录音通过，也不代表逐按钮操作文案已验收。
3. **连接恢复必须重新核实工具和账号**：不能把用户回复“已连接”当成真实授权／读取成功；当前指南能说明阻塞，未来执行承诺仍可能过强。
4. **扩大性能与范围集**：补长会话、默认完整工具集合的成对成本测试、更多 Agent 类型、复杂嵌套模型覆盖和更丰富权限组合。本次主要验证 main，其他 Agent 仅 coder 的固定范围样本。
5. **完整配置闭环仍要后端能力**：capability inspect、语音 preview/apply 与设备回执、真实 Gmail 连接读取、持久 setup 协调器继续按[产品技术方案](../conversational-setup-phase1-2026-10-21.md)实施，不能用当前“正确说明阻塞”冒充完成。

## 证据与复现

[机器可读报告](conversational-setup-compact-evaluation-2026-10-21.json)保存两轮汇总、manifest、逐样本断言、调用和回答，以及 Gateway 原始／复核回执。详细本地原始数据在 `.xopc-evals/conversational-setup/compact-{development-v4,development-v5,regression-v5,scope-v5}/`，包含 source 快照、attempt、模型 usage 和合成 state 路径；目录被 Git 忽略。

运行命令、代理和选择规则见冻结协议。历史 v3 与 v4、正式 v5、Gateway 的网络失败／语言误报分开保存，不删除失败或把无模型检查计入真实成绩。当前工作区已改变，重跑历史 runner 属于新实验，不能直接冒充旧源码结果。
