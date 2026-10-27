# 主模型可编程 UI：实施与原生基线

后续截图稳定性修复、真实模型与 Gateway 网络成对实测见 [网络验证报告](computer-use-network-paired-validation-2026-10-27.md)。本文保留第一阶段数据与当时的验证边界。

日期：2026-10-27。当前为可调用的预览实现，尚未完成真实主模型任务性能对照、Windows 新模式验证或发布认证。

## 本次落地

- 原生输入新增单调时钟分段：identityCheck、actionValidation、Windows input guard、SDK call、resultValidation、renderGrace、unattributed。失败也保留已测输入阶段；不适用的 Windows 阶段为 null。
- 保留已有 precheck/input/postObserve 口径，增加 precheckSamples 和 inputDetail。Runtime 报告按 actionId 去重并有界保留 native/transport/endpoint 时长；同一次派发不会因回执重取重复计时。
- Electron transport 增加 broker、frame upload 和命令总时长；此次原生基线使用进程内适配，没有据此声称已经测到 Gateway 网络或真实上传延迟。
- `computer_use.open` 新增 `planner: "agent"`，`exec` 使用现有 pi-codemode QuickJS worker。脚本仅能调用 UI 原语，复用原有 Runtime dispatch、endpoint、broker、Cua driver；没有新增通用执行服务或 Gateway 路由。
- agent 模式不创建 GUI adapter、不要求单独 GUI 模型；默认 GUI 模式继续工作。主模型绑定来自实际 embedded model request，并检查 run/model/origin/API endpoint hash，脚本不能自报这些身份。
- UI 宿主操作经过 turn policy 的前后钩子。保持单窗口串行、只读权限、精确快照、输入预算、回执和释放门禁；异常/并发/未 await 操作中止程序，不重跑整个脚本。
- 截图只保留在临时 registry，按 owner/run/toolCall/model recipient 注入 provider 请求的副本。持久 transcript、debug payload 和 usage trace input 不包含这些像素。写操作使前一截图失效；请求完成或释放后清理。主模型 turn 结束会释放 agent-mode 会话。
- 复用 JSON store 语义，但 UI store 仅存在会话内存，不追加 codemode-store，也不生成输出 spill 文件。每次调用是新的 JS VM，跨调用变量/函数不保留。

实现主要在 `src/computer/program-runtime.ts`、`agent-context.ts`、现有 `runtime.ts` 和 `src/agent/embedded/run-turn.ts`。原生路径的重用发生在同一个 `dispatchAction`，没有复制另一套执行器。

## 当前驱动真实基线

macOS ARM64，固定 Cua Driver **0.36.0**。二进制 SHA-256：

`87c7e782e69703d95524e4ceb7ceba03c8a159caabf1f1ce2c118eade7d2a5ec`

使用独立 AppKit 测试应用，无账号、网络、文件和用户文档。每类计划 30 次正式采样，第一条预热单独保存。按钮、字段赋值和文本输入通过独立的后续 native observation 检查实际状态。按键仅确认派发，不把光标移动计为独立验证成功。每列分位数分别计算，分位数不能直接相加。

| 操作 | 正式样本 | 独立验证 | 输入路径 P50 / P95 | SDK P50 | 渲染等待 P50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| activate | 30 | 30 | 966 / 1,157 ms | 763 ms | 201 ms |
| setValue | 18 | 18 | 539 / 621 ms | 336 ms | 201 ms |
| typeText | 30 | 30 | 949 / 1,180 ms | 746 ms | 201 ms |
| pressKeys | 30 | 0 | 1,368 / 1,385 ms | 1,165 ms | 201 ms |

身份检查 P50 约 2ms，动作/返回校验约为微秒量级。输入总时间不含 broker 的 fresh precheck、动作后截图、独立 oracle 和模型推理，这些不能从表中直接推算。

主表 setValue 组在第 19 次正式尝试遇到 `COMPUTER_OBSERVATION_CHANGED`，broker 明确没有派发输入。保存已有 18 个样本并停止该组，未重放。早期另一次 setValue 轮取得 29 个有效样本后遇到截图校验失败；该轮数据同样保留，但不混入最终表格。

早期实验还记录了 caret/渲染变化和截图目标验证失败。一个自动清除字段焦点的实验 fixture 导致 typing 的派发不确定，立即停止且未重放；该实验已撤回。最终 typeText 使用每次不同的测试 marker，避免重复输入相同字符串而无法证明变化。最终 fixture 无清焦点 delegate。

构建与测试结束后，还运行了单独字段诊断：3 个正式样本验证通过，第 4 次输入已完成但后续截图校验失败。该动作保留 completed 回执与分段时间，未重放；证据在 additionalFieldDiagnostic，未混入主表。这说明截图可靠性仍是需要继续处理的边界，并非仅由构建负载造成。

采样在开发环境进行，未控制系统背景负载，不作为隔离性能实验。

滚动未采样，因为该 fixture 没有可验证滚动区域；这不代表驱动不支持滚动。所有未完成、未测量和未验证项保持明确状态，不填零。

原始样本、预热、主表分组以及保留的探索轮失败在 [JSON 证据](./evidence/computer-input-baseline-2026-10-27.json) 中。性能表采用最终组，未挑选其中更快的子集。

## 数据指向的下一步

SDK 调用是已测输入路径的主要成本。`sdkCallMs` 包括 SDK/RPC、driver 内部目标解析与确认、OS 工作，不能称为纯 OS 输入时间。现有外层数据无法继续把它拆开；下一步需要固定版本 driver 的内部 span，而不是继续猜测 socket 或 accessibility 耗时。

固定渲染等待确实约 201ms，但它不能解释全部输入耗时。此次保持原有等待和新鲜度校验，未用放宽输入约束换取数字。后续事件等待/轻量观察应单独对照测量。

## 可编程链路真实验证

真实路径：`computer_use` tool → QuickJS worker → 共享 Runtime/Endpoint adapter → 原有 broker → 固定 native driver → 独立 fixture。

固定程序一次完成：

1. 读取当前字段 ref，`setValue` 写入测试 marker 并验证字段。
2. 重新观察按钮，激活 Increment，并验证计数。
3. 请求临时截图；另一条 exec 读取内存 store。
4. 独立 native read 检查字段/计数，close 后检查 frame 清理与 released report。

首轮程序耗时 **4,324.63ms**，完成 2 个输入、5 个宿主操作，字段和按钮独立验证通过，跨调用 JSON 状态与截图清理通过。GUI 模型请求为 0，主模型请求也为 0：这是固定脚本的真实原生链路验证，不是模型规划或端到端 Agent 速度成绩。最终复验再次通过，程序耗时 4,676.75ms，保留在同一 JSON 证据的 finalProgramValidation 中。

## 自动化与构建

相关回归目前 **511 passed / 9 skipped**，包括原有 GUI 模式、真实 QuickJS、只读/陈旧快照/模型路径变更拒绝、并行与 CPU 循环、未 await 调用收敛、失败不重放、临时图像模型投影/日志与 transcript 隔离。

Node/Electron TypeScript 检查、Node 构建（保留已有 dist）、Electron server 构建和独立 bundled-worker smoke 均通过。没有生成签名安装包或发布版本。最终检查结果以本记录后续更新为准。

复现：

```sh
node scripts/setup-computer-driver.mjs
pnpm exec tsx scripts/benchmark-computer-input-live.mts 30
pnpm exec tsx scripts/benchmark-computer-input-live.mts 30 typeText
pnpm exec tsx scripts/benchmark-computer-input-live.mts 1 program
node scripts/build-electron-server.mjs
pnpm exec tsx scripts/verify-computer-program-bundle.mts
```

测试程序只会打开并关闭自己创建的 fixture。原生校验拒绝或不明派发均保留失败证据，不自动重放动作。

## 尚未完成的验证

- 实际主模型自行生成 exec 程序的真实模型任务对照，以及把主模型请求/token/失败计入完整成本。
- 当前 Gateway WebSocket + HTTP frame upload 的新模式真实网络验收；此次使用进程内 endpoint adapter。
- 当前驱动的 Calculator/TextEdit 配对任务复测；本轮没有把历史旧驱动结果作为新模式速度对照。
- SDK/daemon 内部分段、可验证滚动 fixture、Windows 新模式，以及现有 60 任务 × 3 次发布门槛。

因此，目前可以使用新的原生执行模式，但不能宣称已达到 Codex 的通用任务效率。
