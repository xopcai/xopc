# xopc AI 调用可见性与费用账本

日期：2026-09-26  
状态：已实施

## 技术结论

xopc 使用追加式 `ai_usage_events` 账本记录每一次真正发往模型供应商的物理请求。聊天、任务、自动化、Scene 和一次性生成不再分别维护费用数据。

- 调用方声明稳定的 `operation` 及必要归属；场景注册表产生 category、reason key 和默认 trigger。
- 流式请求从发起到最终 `result()` 只对应一条记录。
- 有模型价格时冻结请求当时的价格快照，费用以微美元整数存储。
- 无价格、订阅或无法换算的调用显示“费用未知”，不冒充 `$0`。
- 不存储 prompt、完整响应、工具参数或附件内容；错误文本截断并脱敏。
- 用户界面只提供 `/settings/usage`，不在助手消息底部或会话详情中展示用量。

## 数据与状态

`ai_usage_events` 保存调用和 trace 身份、conversation/run/agent 归属、场景、模型、耗时、token 分项、费用来源、价格快照和有界错误。状态为 `running | succeeded | failed | aborted | unknown`。

请求发起前插入 `running`，最终消息到达时更新 usage、费用与状态。开始和结束分别提交，不持有跨网络事务。Gateway 启动时把超过 6 小时的孤立 `running` 记录收敛为 `unknown`。

## 运行时接入

1. 主 Agent 和后台审查在 stream function 边界接入。
2. 一次性请求通过 `completeWithResolvedCredentials` 或 `createResolvedModelStream` 强制传入用量上下文。
3. Scene executor 直接写入统一账本；旧 `scene_model_usage` 表、写入回调和详情页费用面板已删除。
4. 编辑器文本辅助等直接流式调用在真实供应商边界接入。

## API

以下路由使用 `gateway.admin` 权限：

- `GET /api/usage/summary`：总计及按场景、模型聚合。
- `GET /api/usage/events`：按时间倒序的物理调用，支持游标。
- `GET /api/usage/events/:id`：单次调用详情。
- `GET /api/usage/traces/:traceId`：同一运行的调用链。

查询支持时间、category、provider、model、agent 和 conversation 过滤，单次时间范围最大 366 天。

## 界面

`/settings/usage` 位于“会话”和“日志”之间，提供 7／30／90 天时间范围、总量、按场景和模型汇总，以及最近物理调用。每次调用展示发生原因、模型、时间、Token、费用和状态。

页面复用现有设计 token、项目选择器、路由级懒加载和骨架屏，不引入第二套组件系统。

## 边界

- 费用是 API 已知或按模型目录估算的值，不是供应商月度账单。
- 没有 usage 的失败请求保留空 token 和未知费用。
- 首版不做预算拦截、账单对账、付款或发票。
