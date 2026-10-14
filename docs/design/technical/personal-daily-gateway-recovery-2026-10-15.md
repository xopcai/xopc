# 日常 Gateway 恢复修复与通过基线

已应用到日常 Gateway 并重启。固定版本真实验证通过，端口 18790，最终进程 8129；结束时没有 running/queued TaskRun。Personal 保存偏好为 `brief`。

## 修复

- **502 后恢复**：合同规划与研究审查使用当前配置的主模型和备用模型，检测返回值中的 provider error，而不只捕获抛出异常。仅瞬时错误触发有界切换，沿用原调用截止时间；认证、额度和取消错误不被当成可重试错误。
- **逐项验收展开**：主规划模型 502 后由已配置备用模型生成具体条件。无效规划响应不再静默降级；模型返回的写入范围禁令保存为合同约束，不以报告声明来证明所有未观察操作均未发生。既有约束保留。
- **返工续跑**：证据校验、读取失败不再被混同于未确认的外部写操作。模型失败时保留当前文件缺口与验收缺口，同一 TaskRun 继续处理，不重放已完成外部操作。
- **完成后的返工模型切换**：已完成的 worker 回合进入自动返工后，主模型失败只追加运行记录，不会新增用户消息。会话恢复现在识别这一状态并重新发送 host 的返工指令，允许调用已配置备用模型；不重跑原始用户任务。未知工具结果、取消、新用户输入冲突等保护仍保留。
- **审查依据**：传入 host 记录的来源访问时间及 ISO 时间，区分访问时间与发布时间。报告是否包含所需日期、引用或声明通过已读取发布文件检查；外部事实仍必须由原始来源支持，不能用报告自证。

## 固定版本真实结果

记录：[DAILY-RESEARCH-f5fd39d7](../../../evals/personal/baselines/DAILY-RESEARCH-f5fd39d7.json)。本轮直接使用日常 Gateway、日常 personal 对话和真实配置模型，没有隔离 Gateway、模拟模型输出或人工补发。

| 检查 | 结果 |
| --- | --- |
| 完整链路时长 | 178.052 秒 |
| 实际模型故障 | `openai-codex/gpt-5.5` 出现真实 502；配置中的 `auto` 成功接续 |
| 具体验收 | 6/6 passed，已替代 2 条通用模板 |
| 证据 | 15 个实际工具来源、17 条 supported 结论；保留工具调用 ID、来源 URL 和快照哈希 |
| 中途改要求 | Personal 转发给同一任务；1/1 instruction check passed，新增 change_notes.md 含独立标记 |
| 文件失效 | 删除本测试已发布 report.md；同一 TaskRun 自动续跑一次并重新发布不同 URI |
| 发布后审查 | 最终四份文件版本全部检查，最终 verification passed |
| 下载 | report.md、monthly_summary.csv、reproduce.mjs、change_notes.md 均认证 HTTP 200；匿名均 HTTP 401 |
| 交付后再检查 | 四份文件再次下载，字节 SHA-256 与基线一致 |
| Personal 表达 | 中文 163 字、3 句话，保留 150、210、40% 和四份文件名称 |
| 版本稳定 | sourceChangedDuringRun=false |

研究包含实际访问的 MDN HTTP 404 页面，以及与其冲突的次级测试资料。销售数据为合成数据，独立计算为 150、210、环比 40%，可复现脚本实际运行。本样本验证链路与故障恢复；来源支持与语义判断明确属于模型审查，不是独立专家事实认证。

## 回归与复跑

- [固定恢复基线](../../../evals/personal/baselines/p2-recovery-final-frozen.json)：48/48，通过且源码未变。新增配置备用模型、规划 502、证据校验失败与文件丢失并存、未知外部效果禁止重放等用例。
- 恢复与会话 HTTP/SSE 集成测试批次 89 项通过；规划、审查和分发批次 43 项通过；另外交付、任务执行与 Personal 回归批次 92 项通过。批次有重叠，不把数量相加。
- `pnpm run typecheck` 和 `git diff --check` 通过。

```sh
XOPC_ALLOCATION_LIVE=1 pnpm exec tsx scripts/personal-daily-gateway-smoke.mts
```

日常验证脚本等待重启后的 Gateway 就绪，再经公开认证 API 提交任务与修改要求；只读 SQLite 用于观察。成功须同时满足具体验收、证据关联、文件重发、原对话下载和源码版本稳定；失败样本也保存交付、模型错误和下载情况。

## 本次开发记录

| 记录 | 判定 |
| --- | --- |
| DAILY-RESEARCH-50a37143 | failed；规划已恢复，续跑后的模型切换仍被运行记录阻断 |
| DAILY-RESEARCH-11c773f3 | failed；重启尚未就绪时请求失败，未创建 Task；脚本随后补充就绪等待 |
| DAILY-RESEARCH-77d0d0a1 | failed；已实际完成审查，暴露完成回合返工的模型切换边界 |
| DAILY-RESEARCH-9d806c2b | 功能检查通过，但源码在运行期间有改动；整体仍记 failed |
| DAILY-RESEARCH-f5fd39d7 | passed；固定版本、无人工干预、全部链路检查通过 |

此前两轮失败记录仍保留。仅最后一轮作为当前日常 Gateway 的固定版本通过基线；不把开发试跑或运行中改代码的记录合并成可靠性百分比。
