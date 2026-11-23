# 事件驱动主动感知（Proactive Hub）与能力沉淀优先（Bounded RSI）建设方案

日期：2026-11-23。状态：Milestone 1–4 工程闭环已实现并完成单元、组件与鉴权路由验证；真实外部模型与长期线上样本质量留待生产环境评估。

关联设计：[Personal Agent 主动参与与成长技术方案](./personal-agent-proactivity-technical.md)、[自动化可靠性与业务接入契约](./automation-reliability-integration-contract.md)、[Benchmark 驱动 Harness 持续自我迭代建设方案](./benchmark-driven-harness-evolution-plan.md)。

---

## 1. 核心目标与架构决策

1. **全域信号宽进（Wide Signal Ingress）**：统一生产力连接器信号（邮件、日历、GitHub、Linear、Webhook、MCP 快照差异）与本地环境/桌面信号（已授权目录文件批次变更、绑定项目 Git 状态、桌面空闲/状态切换、浏览器显式收藏、内部 Task 与时间窗口信号）进入 `AutomationEventEnvelope`。
2. **四级漏斗严出 + 受限只读预准备（Strict Funnel + Read-Only Scout）**：
   - **Gate 1（0-Token 确定性预筛与滑动窗口归并）**：通过 `proactive_subscriptions` 规则匹配、活跃项目/关注锚点关联、`coalesce_window_ms` 防抖归并与 `sha256` 内容指纹去重，在零模型开销下消解绝大多数高频事件噪音。
   - **Gate 2（轻量分类门禁）**：无工具极速判别 `drop | digest_only | run_scout`。
   - **Gate 3（受限只读侦察 Scout）**：仅对高潜信号在授权只读范围内拉取本地记忆、项目知识与只读源片段，准备可验证的事实摘要与草稿方案；严禁执行写文件、Shell、外发消息或修改外部服务，外部变更一律表达为 `ask_before_apply` 待确认动作。
   - **Gate 4（VoI 价值评分与打扰治理）**：综合可行动性、时间敏感度、新颖度、准备充分度与打扰惩罚（免打扰时段、前台活跃对话/语音、每日对话穿透预算、近期忽略率）进行路由。
3. **三层用户触达面（Inbox + Pulse 为主，重点穿透对话）**：
   - **Tier A（`tier_a_inbox`）**：已准备好草稿或待拍板事项进入统一 **Agent Inbox**，支持 `approve / edit_and_approve / move_to_digest / snooze / mute_rule`；
   - **Tier B（`tier_b_digest`）**：有用但非紧急的动态进入脉冲缓冲池，按早/晚时间窗聚合成 **Pulse Digest** 简报，零即时打断；
   - **Tier S（`tier_s_chat`）**：仅紧急阻塞、临近窗口冲突或用户显式约定的跟进穿透至 **Personal 主对话**（复用 `personal_proactive_message` 与缘由尾巴协议）。
4. **能力沉淀优先的受控自进化（Capability-First Bounded RSI）**：
   - 优先消费四类高信噪比信号：① 经历报错后排障恢复并通过验证的任务回执（`recovered_failure`）；② 用户在 Inbox 对预备草稿执行 `edit_and_approve` 产生的结构化差异（`human_edit_diff`）；③ 用户对主动推送执行静音或降级（`triage_mute`）；④ 跨任务重复工作流（`repeated_pattern`）。
   - 生成带 **SIM（Self-Improvement Memory：问题模式、修改原因、适用范围、反例边界）** 的暂存候选（`skill`、`routine_method`、`filter_rule`），必须通过**静态与敏感性扫描（Gate A） + 能力保持检查（Gate B） + 作用域与权限不越界（Gate C）**三道门禁后，才进入 Inbox 供用户确认采纳，并保留完整旧版快照支持一键无损回滚与线上遥测监控。

---

## 2. 安全与可靠性不变量

1. **感知与自进化均不扩权**：任何外部事件唤醒或 RSI 候选采纳，均不得扩大工具执行白名单、外部账户授权范围、目录访问授权或隐私策略（`local_only` 下暂停远程模型后台处理）。
2. **外部载荷永不可信**：连接器、Webhook 与外部文件的文本一律包裹于不可信数据边界内，与控制指令物理隔离，防止间接提示词注入触发越权操作。
3. **暂存与正式运行物理隔离**：RSI 合成的 `SKILL.md` 先写入独立 `skills-staging/` 目录完成校验，未经门禁通过与显式采纳不得写入工作区或全局正式技能目录。
4. **单次决策与幂等状态同步**：同一 `idempotency_key` 重复提交不产生副作用；Tier S 穿透至对话的条目与 Inbox 共享同一 `proactive_items.id`，任一入口处理后统一完结。

---

## 3. 数据模型（SQLite v282）

在 `src/storage/sqlite/upgrades/282_proactive_rsi.sql` 与 `schema.sql` 中新增五张持久化表：

- `proactive_subscriptions`：全域信号订阅、字段级谓词匹配与默认路由策略；
- `proactive_coalesced_signals`：Gate 1 滑动时间窗防抖归并与内容指纹去重账本；
- `proactive_items`：统一管理 Tier S / Tier A / Tier B / Tier C 主动条目、预备成果与人类处理回执；
- `rsi_capability_candidates`：暂存候选技能、Routine 方法版本与 Gate 1 过滤规则补丁，保存 SIM 元数据、验证报告与回滚快照；
- `rsi_capability_telemetry`：追踪已采纳能力的调用次数、验证成功数、失败数与人工二次编辑数，支撑劣化回滚预警。

---

## 4. 模块划分与分期边界

| 模块 / 阶段 | 代码位置 | 状态与职责 |
| :--- | :--- | :--- |
| **Milestone 1：主动漏斗底座** | `src/proactive-hub/`、`src/automations/events/event-catalog.ts` | 已实现：领域/连接器/本地授权目录信号注册、Gate 1–4 漏斗、受限只读 Scout、Pulse 缓冲聚合与 Personal 对话穿透 |
| **Milestone 2：工作台 Inbox & Pulse UI** | `web/src/features/proactive/`、`web/src/pages/home-page.tsx` | 已实现：工作台 `ProactiveInboxCard`、固定尺寸草稿审阅/编辑弹窗、早晚脉冲简报抽屉、静音规则选择器与 RSI 能力回滚面板 |
| **Milestone 3：能力沉淀 RSI 核心** | `src/rsi/`、`src/gateway/hono/routes/proactive-rsi.ts` | 已实现：排障恢复轨迹与人工改稿 Diff 提取、静音转 0-Token 过滤规则、SIM 构建、三道门禁校验、原子采纳/回滚与遥测账本 |
| **Milestone 4：重复工作流挖掘与定时脉冲/渠道推送** | `src/rsi/service.ts`、`src/proactive-hub/pulse-automation.ts`、`src/gateway/service.ts` | 已实现：跨任务重复模式（$\ge 3$ 次）自动提炼标准技能、早晚 08:30/18:30 脉冲简报系统自动化对账、Tier S 随身微信私聊与通知推送同步 |

---

## 5. 实施与验证记录（2026-11-23）

- **SQLite v282 升级链**：新增 `src/storage/sqlite/upgrades/282_proactive_rsi.sql` 并同步 `schema.sql`；`schema.test.ts` 与 `schema-upgrade.test.ts`（v202–v281 全版本升级、WAL 备份与回滚一致性）及 Electron 打包布局检查全部通过。
- **Milestone 1 & 4 主动漏斗与定时脉冲验证（`src/proactive-hub/__tests__/proactive-hub.test.ts`）**：验证 100 条混合事件风暴下 >90% 事件在 Gate 1 零模型开销拦截或滑动窗口归并、不可信外部载荷边界包裹、Tier S 紧急日程冲突穿透至 Personal 会话与随身通知、Tier A 待审草稿落入 Inbox、Tier B 动态静默缓冲并聚合成单张 Pulse 简报卡、本地授权目录与 Git HEAD 增量采集，以及早晚 08:30/18:30 定时脉冲自动化幂等对账。
- **Milestone 3 & 4 RSI 闭环与鉴权路由验证（`src/rsi/__tests__/rsi-service.test.ts`、`lazy-bundles.test.ts`）**：验证人工 `edit_and_approve` Diff 自动沉淀 `SKILL.md`（v1 → v2 保留既有结构与快照、线上遥测劣化预警与字节级无损回滚）、排障恢复成功轨迹提取恢复技能、跨 3 次独立验证任务挖掘重复工作流技能（`repeated_pattern`）、含密钥/越权指令候选被 Gate A 拦截，以及真实鉴权 Gateway HTTP 下 `mute_rule` 自动转 Gate 1 过滤规则与回滚恢复。
- **Milestone 2 前端工作台验证（`web/src/features/proactive/__tests__/proactive-inbox-card.test.tsx`、`home-page.test.tsx`）**：验证工作台内联草稿修改触发 `edit_and_approve`、当期脉冲简报手动合成、RSI 已采纳技能一键回滚，以及空闲/待办态与既有 `HomePage` 交互无回归。
