# 任务能力路由基线

[设计与完整通过标准](../../docs/design/task-capability-routing.md)定义 R01–R13，R14 复现实际两轮积分查询。`cases.mts` 保存业务请求、条件、验收标准与当前可执行探针的对应关系。

## 运行 15 组探针

```sh
node --import tsx scripts/task-capability-evaluation/run.mts
```

默认输出到 `.xopc-evals/task-capability-baseline`，可用 `--out` 改写。报告按文件和测试名核对断言。缺少证据的断言标为 `missing`，组件组标为 `incomplete`，不会当成通过。`vitest.json` 包含选中文件的全部测试，`component-baseline.json` 包含每组指定的断言和端到端覆盖缺口。

## 运行已有真实模型子集

以下使用生产 Gateway、System Prompt 和 Web Chat，依赖已构建的 Web 静态资源、Playwright Chromium 和已登录的 XOPC Cloud。每次启动使用独立数据库、目录、会话和模拟业务服务。运行会请求真实推理。业务查询和授权使用测试账号与本地夹具。

```sh
for case_id in R02 R07 R10; do
  XOPC_CONFIGURATION_E2E_LIVE=1 \
  XOPC_CONFIGURATION_E2E_STAGE=mcp \
  XOPC_CONFIGURATION_E2E_TASK_ROUTING_CASE="$case_id" \
  XOPC_CONFIGURATION_E2E_OUT=".xopc-evals/task-capability-baseline/$case_id" \
  node --import tsx scripts/verify-conversation-configuration-e2e.mts
done

for auth_kind in token oauth; do
  XOPC_CONFIGURATION_E2E_LIVE=1 \
  XOPC_CONFIGURATION_E2E_STAGE=mcp \
  XOPC_CONFIGURATION_E2E_NAME_FLOW=1 \
  XOPC_CONFIGURATION_E2E_TASK_ROUTING_CASE=R05 \
  XOPC_CONFIGURATION_E2E_NAME_KINDS="$auth_kind" \
  XOPC_CONFIGURATION_E2E_OUT=".xopc-evals/task-capability-baseline/R05-$auth_kind-isolated" \
  node --import tsx scripts/verify-conversation-configuration-e2e.mts
done
```

设置 `XOPC_CONFIGURATION_E2E_TASK_ROUTING_VARIANT=en` 可在 1280px 视口跑 R05 英文请求，默认用 390px 视口。R05 校验宿主卡片是唯一连接入口、Token 弹窗可在刷新后恢复、只生成一条续跑输入并交付真实后端结果。

R02 使用已配置 MCP 真实读取测试账号标记码，工单排序仍待独立夹具覆盖。R07 只执行已启用 Skill 的变体，R10 只执行纯咨询的变体。R05 分别运行 OAuth、Token，普通查询提示词不包含连接指令。移除 `XOPC_CONFIGURATION_E2E_TASK_ROUTING_CASE` 可运行原有显式连接对照，该对照使用原脚本的目录设置。

每个进程写入 `result.json`，记录阶段断言、工具调用与模型请求状态。诊断目录可能含完整模拟会话和请求载荷，保留在被 Git 忽略的评测目录。报告中只摘录判断所需的非敏感状态。

## Browser Use 的真实浏览器探针

```sh
XOPC_BENCH_OUTPUT=.xopc-evals/task-capability-baseline/browser-runtime.json \
node --import tsx scripts/benchmark-playwright-browser.mts 1
```

如有需要，用 `XOPC_BENCH_CHROMIUM_PATH` 指定本地 Chromium 兼容浏览器的可执行文件。该入口使用真实网页夹具测导航、筛选和会话隔离，动作由脚本发起。

[首轮结果](../../docs/design/technical/task-capability-routing-baseline-2026-11-14.md)

## R14 深度回归

使用 `DEEPSEEK_API_KEY` 和真实 `deepseek-flash`。在隔离 Gateway 重放「帮我查询下麦当劳积分」和「我需要你帮我查询」，已注册工具包含无关结果，麦当劳 Token 接入和积分由本地测试服务提供。评测检查可用 MCP 路径优先、模型不会提前调用浏览器，以及原会话拿到模拟服务的积分。

```sh
XOPC_CONFIGURATION_E2E_LIVE=1 \
XOPC_CONFIGURATION_E2E_STAGE=mcp \
XOPC_CONFIGURATION_E2E_NAME_FLOW=1 \
XOPC_CONFIGURATION_E2E_TASK_ROUTING_CASE=R14 \
XOPC_CONFIGURATION_E2E_NAME_KINDS=token \
XOPC_CONFIGURATION_E2E_OUT=.xopc-evals/task-capability-r14-final \
node --import tsx scripts/verify-conversation-configuration-e2e.mts
```

上一版执行层规则的历史结果（2026-11-14）。首次运行在第二轮尝试直调设备网页导航，执行层在实际导航前拒绝了它，随后创建 MCP 授权，原会话读到测试余额 738214。使用补全后的评分复跑，发现先于浏览器，且模型未再尝试浏览器。14 组组件和集成探针共 265 条测试通过，包含同服务无匹配放行、过期或错会话结果拒绝、认证不确定时继续等待。最终截图超时，工具回执、续跑队列和实际读取结果均已校验。

当前 System Prompt 路由版已移除句式匹配和运行时浏览器阻断。用同一 R14 和真实 deepseek-flash 复跑通过，模型在无关工具搜索结果后主动调用 MCP 发现，浏览器调用为 0，授权后返回测试积分。14 组组件和集成探针共 258 条通过。最终诊断截图超时，业务读取及续跑断言通过。

## R15 无 MCP 时的网页兜底

三个虚构账户服务用同一个 Gateway 路由和真实 Playwright Browser Use。第一轮给服务和业务目标，第二轮以不同措辞补账户地址。目录及 MCP 搜索返回空结果；实际数据只有用户提供的账户网页交互后才可见。模型仍拥有原有工具，评测将用 shell 读取网页记为失败。

```sh
for variant in loyalty support billing; do
  XOPC_CONFIGURATION_E2E_LIVE=1 \
  XOPC_CONFIGURATION_E2E_STAGE=mcp \
  XOPC_CONFIGURATION_E2E_TASK_ROUTING_CASE=R15 \
  XOPC_CONFIGURATION_E2E_TASK_ROUTING_VARIANT="$variant" \
  XOPC_CONFIGURATION_E2E_OUT=".xopc-evals/task-capability-r15/$variant" \
  node --import tsx scripts/verify-conversation-configuration-e2e.mts
done
```

需要 `DEEPSEEK_API_KEY`、已构建的 Web 静态资源和 Playwright Chromium。通过标准依次读取同名 MCP 搜索、明确 `no_match`、实际 `browser_use` 调用与读取回执、最终数值。页面请求记录用于核对读到的是夹具结果。

实测结果。加入通用 Browser Use 指引后的三轮中，积分与工单各通过 3/3。账单 0/3 严格通过，其中两次按正确顺序通过 Browser Use 读到金额并交付，但额外调用 shell；一次在第一轮没有账户地址时提前调用 shell。调整前的样本也保留，出现跳过 Browser Use 或误把 Chrome 扩展状态视为浏览器不可用。评分标准未放宽。15 组组件与集成检查共 258 条通过。

### 浏览器回执后的停止条件

Cedar Meter 的原始失败回执已经包含正确账户页及 `textbox "Amount due in dollars" value="284672"`。模型一次声称文本框不足以确认单位，随后用 `curl` 读取详情和入口；另一次离开已取得结果的页面，连续遇到页面错误后运行 `ls`。首轮缺少网址时也出现过与任务无关的 shell 探测。

当前候选明确以浏览器观察中的可见字段和标签作为页面证据。目标页面已给出请求的值与单位时直接交付。需要补证时留在同一浏览器会话；缺少入口时请求地址并结束当前回合。浏览器工具说明、手册及通用 shell 指引保持一致。R15 固定三个原有夹具、两轮请求和原评分，保留任意 shell 调用均判失败的条件。

按最终对齐的指引，使用 deepseek-flash 连跑每个变体三次，严格通过 7/9。积分 3/3，工单 2/3，账单 2/3。完成第二轮的七次都按 `no_match → browser_use → 最终结果` 执行，读到结果后未调用 shell。剩下两次分别在账单与工单的第一轮调用了 `true` 与 `echo check`，原判分均为失败。该结果说明直接读到网页证据后的重复核验有所改善，入口缺失时的无关探测仍会发生。证据目录为 `.xopc-evals/task-capability-r15-aligned`。
