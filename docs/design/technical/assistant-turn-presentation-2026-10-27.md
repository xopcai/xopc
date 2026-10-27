# Web UI assistant 过程聚合与最终结果

日期：2026-10-27

## 行为

Personal 与普通聊天复用同一轮回复视图。已确认的进度旁白、thinking 和工具调用归入执行过程。流式正文候选、最终正文与交付物保留在独立结果区，正文表格不进入过程的滚动容器。连续工具调用合并为阶段摘要；旁白保留阶段边界，展开摘要可查看每次调用和已有结果卡片。摘要按具体动作归类（例如读取文件、更新笔记、操作浏览器），最多展示两类动作及重复次数，其余以“另 N 项操作”收起。未知调用才使用“其他操作”，失败调用独立计数，不计入已完成动作。

运行中默认展示最近三个过程分组，之前的过程可以展开。用户手动收起后，新事件不会强制展开。完成后过程自动收起，用户可以重新展开；如果用户正在选择过程文字，则延迟收起，避免打断复制。原始 thinking 仍然只出现在开发者详情中。

复制、朗读、保存笔记复用最终结果投影，不混入过程旁白。历史消息合并保留最早开始时间，避免计时随 assistant 片段变化。

## 配置保持不变

- `gateway.webchat.activityDetailDefault` 仍使用 `off / on / stream`。
- `off` 保留即时文字流，隐藏常规过程详情；`on / stream` 使用聚合过程和完成折叠。
- 简洁设置仍隐藏开发者选项；高级设置中的原有原始工具数据开关可以查看逐次调用、输入输出和 thinking。
- 没有新增配置字段、设置入口、依赖或数据库迁移。存储的 transcript 不变，聚合属于展示投影。

## 最终回复确认

沿用现有 `assistant_message_end.presentation`、内容顺序和 `segmentId`。工具调用之前的文字归入过程；已知独立模型片段中，只将最后的回答片段留在最终正文。

当前模型流没有通用的“最终回复开始”标记。所有模式下，未确认的 `pending` 文字均在独立正文区域实时显示；确认 `answer` 后保持原渲染位置和 Markdown DOM。后续实际开始工具调用或新一段 thinking 时，前面的待定文字才确认归入过程旁白。没有通过关键词或表格格式猜测回复意图。

如果漏收 `assistant_message_end`，权威的成功 run 结束状态会补齐最后一段 `pending` 的 `answer` 分类，之前的待定过程片段归为 `narration`。取消或失败不会将待定文字标记为已确认答案，但已收到的部分正文仍然可以阅读和复制。收尾操作可以重复调用。

如果同时漏收 run topic 的 `run_end`，沿用现有 sessions topic 和 `/api/session-runs` 的恢复机制。测试通过在浏览器 WebSocket 层拦截终止事件验证恢复，没有添加新的轮询参数、超时猜测或配置项。

## 验证

```bash
pnpm exec vitest run --project=web web/src/features/chat web/src/features/settings/__tests__/activity-detail-config-api.test.ts
pnpm run test:web:activity:e2e
XOPC_ACTIVITY_DROP_END=message pnpm exec tsx scripts/verify-assistant-activity-browser.mts
XOPC_ACTIVITY_DROP_END=all pnpm exec tsx scripts/verify-assistant-activity-browser.mts
```

验证结果：187 个聊天测试文件、1,187 项测试通过（含流式表格隔离、结束事件漏收、取消/失败与重复收尾）；Web 生产构建（包含类型检查）与修改源码的 ESLint 检查通过。浏览器验证结果见 [机器可读记录](./evidence/assistant-activity-browser-2026-10-27.json)。

浏览器测试使用生产 Web UI、真实认证 Gateway、REST/WebSocket、Agent 文件工具和 SQLite。只有模型推理由本地可控 SSE 服务替代，不依赖外部模型或用户凭证。服务与数据库使用临时目录，测试结束后清理。

E2E 覆盖纯文本回复在仍然流式生成时独立展示表格、有工具活动时的正文表格隔离、单条消息结束事件丢失、所有实时结束事件丢失时的 REST 恢复、实时旁白、连续文件工具聚合、缺失文件、手动收起、完成折叠、详情重开、刷新恢复、375px 窄屏、现有三种过程模式、简洁/高级设置、原始 thinking 详情和只复制最终结果。

默认截图与运行结果：`/tmp/xopc-assistant-activity-browser/`。故障注入的目录分别追加 `-message` 和 `-all`。可以使用 `XOPC_ACTIVITY_EVIDENCE` 指定输出目录。

Personal 入口的分层、流式状态与完成行为也由共享消息渲染器的组件测试覆盖。
