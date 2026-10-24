**Phone Use 可靠性优化报告 — 2026-10-24**

本次依据 Open-AutoGLM 的动作历史、输入语义和纠错规则，对 xopc 手机模型适配、执行闭环及完成验证进行了优化。基线为 `c433069cd0a7231b5f5aa07bb1c78f99b95a1f82`，优化结果为本次工作区代码。开发按模型适配、输入驱动、评测三部分并行推进，由主任务整合运行时并复核；同一测试模拟器的操作串行执行。

**1. 已落地的能力**

| 改进 | 实现与作用 |
|---|---|
| 完整动作上下文 | 会话内保留最多 24 条详细轨迹，模型收到最近 8 条及有界的较早步骤摘要，包括动作参数、派发状态、应用、观察变化和有限文本事实；输入和轨迹不写入持久化报告。 |
| 原生 UI 辅助 | 模型收到最多 40 个原生节点，聚焦字段优先，坐标归一化，排除密码节点；显式完成条件也会传给模型，说明原生验证仍未满足。继续使用截图定位，不引入第二套设备控制通道。 |
| 输入替换语义 | AutoGLM `Type` / `Type_Name` 映射为替换；结构化 `typeText` 支持 `insert` / `replace`，默认插入以保持兼容。替换前确认同一字段，在支持时 Ctrl+A 后只输入一次，再准确验证最终值。 |
| 输入后验证 | ASCII 和 Unicode 都验证对应字段；最多三次观察容纳延迟更新，绝不通过重发输入进行“验证”。密码字段、手动输入策略及不确定结果停机继续保留。 |
| 有界恢复 | 提示模型检查上一步效果、改变失败路径并保持用户约束；相同语义页面上反复执行同一动作时暂停为 `no_progress`，等待查看及交还，不无限消耗预算。 |
| 协议兼容与修复 | 支持 `Type_Name`、解析有界等待时长、输出预算最多 3000 tokens、识别截断及异常结束。协议异常每次 run 最多修复一次，所有请求均计入原有预算。 |
| 页面新鲜度 | 保留应用、方向、几何、目标及页面语义变化的拦截。仅对明确的非交互系统时钟节点 `com.android.systemui:id/clock` 的时间文本作豁免；时钟变化不算动作进展。 |
| 组合完成条件 | `completion` 支持应用包名、文本任选/全选、字段准确值及本次 UI 变化要求；旧 `expectText` 同时兼容。验证检查全部已采集节点，不受显示事实 60 条的限制。 |
| 连续完成复核 | 条件必须在连续两次新观察中成立。复核之后重新检查取消、控制权和设备授权，防止发布过期完成结果。 |
| 提前结束纠正 | 模型 `finish` 但显式 UI 条件未满足时，最多提供一次带条件的纠正反馈并重新观察；消耗正常请求预算。仍未满足则保留 `model_finished_unverified`，不强行报告成功。 |
| 诊断 | 报告增加陈旧预测、协议修复、未变化动作和提前结束纠正计数；日志仍不记录原始输入或截图。 |

实现主要位于 `src/phone/model-adapter.ts`、`runtime.ts`、`adb-driver.ts`、`reliability.ts` 和 `contracts.ts`。工具声明、英文/中文说明及工具手册已同步。

**2. 模拟设备回放对比**

使用生产 `PhoneRuntime`，连接可重置的模拟设备和固定脚本策略。基线从 Git 读取旧 `runtime.ts`，共享当前配置、驱动类型及仓储，因此本实验仅测运行时行为，不能测模型理解、真实应用适配或输入驱动整体收益。

13 种场景各运行三轮：6 种完成任务、7 种保护条件。三个普通任务与三个时钟任务分别为一至三阶段；三个时钟任务验证同一种机制，不应解释为三个独立 App 能力。保护条件包含目标移动、新覆盖层、商品标题变化、消息对象变化、静态/时钟页面无进展及派发结果未知。

| 指标 | 旧运行时 | 优化后 |
|---|---:|---:|
| 模拟任务完成 | 9/18 | 18/18 |
| 保护条件通过 | 15/21 | 21/21 |
| 脚本策略调用 | 327 | 201 |
| 原生观察 | 402 | 306 |

整套固定场景的策略调用减少 38.5%；普通静态页面没有引入已观察到的退化。该差异主要由时钟误拦截和有界无进展处理产生，不能外推为真实模型或真实 App 的完成率提升。重复三轮主要验证可重复性，不提供统计独立性或泛化结论。

证据：[模拟回放 JSON](evidence/phone-reliability-replay-2026-10-24.json)。

**3. 真实 Android 输入验证**

在专用 `XOPC_Android_Test_API_35` 模拟器（Android API 35）上执行实际 `AdbPhoneDriver`，仅操作 Settings 搜索字段，未切换系统偏好。由额外一次独立观察确认最终准确值：

| 操作 | 独立观察结果 | 耗时 |
|---|---|---:|
| 占位字段 → `oldcoffee` | 通过 | 3.78 秒 |
| `oldcoffee` → `wifi` | 通过 | 3.83 秒 |
| `wifi` → `咖啡😀` | 通过 | 4.21 秒 |

验证发现：清空 Settings 搜索框后，原生节点把 `Search settings` 占位文字当作字段值返回，导致最初的空字符串验证误判。最终实现改为选择现有内容后单次输入替换，以最终准确值判断结果，不再依赖空字符串检查。不安装 ADB Keyboard，不切换输入法，不读取历史剪贴板。

证据：[真实输入 JSON](evidence/phone-reliability-input-2026-10-24.json)。

**4. 真实 AutoGLM 配对测试与发现**

真实调用 `autoglm-phone`，使用同一专用 API 35 模拟器，隔离临时配置/模型注册和数据库。测试为“关于手机返回 Settings 主列表”和“主列表进入关于手机”，每组从重置的 Settings 任务栈开始，记录初始原生 UI 指纹，并使用独立的最终原生观察检查结果。旧版运行时与旧版适配器从固定提交读取，ADB 驱动为当前共享实现；这些导航任务不测试替换输入。

初轮有效结果为基线 2/2、改进中版本 1/2。改进中版本曾在独立检查不通过时返回 `verified=true`；该失败保留为证据，并推动连续两次观察和组合条件的修复。初始通用 Settings intent 被另一个搜索 Activity 截获造成的无效启动单独保存，没有混入有效成功率。

加入完成复核后的第二轮有效结果为基线 1/2、优化版 1/2。基线遇到协议错误；优化版未完成的任务明确返回 `model_finished_unverified` 和 `verified=false`，避免了前一轮的错误完成验证，但也暴露模型提前 `finish`。为此进一步加入一次有界的显式条件纠正。继续复验仍出现提前结束；人工检查证实屏幕底边仅露出了 Android version 标签的一部分，而原生节点并未认为该行可见。最终进一步向模型明确传入完成条件，并要求先滚动，使必要行完整可见；所有中间失败均保留。

最终复验结果如下，两臂的任务初始 UI 指纹相同：

| 版本 | 独立检查完成 | 实际模型调用 | 两项任务执行耗时 |
|---|---:|---:|---:|
| 固定旧版本基线 | 1/2 | 9 | 55.277 秒 |
| 最终优化版 | 1/2 | 9 | 63.961 秒 |

第一项两臂均完成；第二项基线未验证结束，优化版在 55 秒单次运行预算后以 `operation_timeout` 暂停且 `verified=false`。最终版本没有错误报告第二项已验证完成，但严格验证并未解决模型在该任务中的导航问题，也有观察耗时成本。本轮真实任务没有证明完成率或速度改善。

所有开发阶段合计 50 次真实 API 调用：无效启动设置 2 次，完成复核前 9 次，仅完成复核后 9 次，完成条件上下文前 12 次，最终配对 18 次。中间结果用于定位问题，不能挑选较好的轮次作为最终成绩。最终证据包含生产源码 SHA-256，可区分工作区版本。

数据见[最终真实模型 JSON](evidence/phone-reliability-live-final-2026-10-24.json)。样本只有两个任务、每臂一次；即使最终通过，也不能据此宣称一般真实任务完成率提升。应在更多 App、更多初始状态和重复运行中继续收集结果。

保留记录：[完成复核修复前](evidence/phone-reliability-live-before-confirmation-2026-10-24.json)、[仅完成复核之后](evidence/phone-reliability-live-after-confirmation-2026-10-24.json)、[显式条件传入模型之前](evidence/phone-reliability-live-before-criteria-context-2026-10-24.json)、[启动设置失败](evidence/phone-reliability-live-setup-failure-2026-10-24.json)。证据不包含截图或密钥。

**5. 回归验证**

测试覆盖模型上下文的有界裁剪与密码排除、协议别名和截断、输入延迟/失败不重发、轨迹与派发效果、持久化隐私、有界协议修复及预算、组合条件和显示事实之外的验证、初始已有状态、瞬时文本消失，以及完成复核期间取消、接管和设备授权撤销。原有派发结果未知不重试、陈旧坐标、输入策略、手动接管、路由及手机面板测试继续执行。

最终检查数量、构建和 lint 结果在最终结果记录中列出。

**6. 复验方式**

```bash
XOPC_LOG_LEVEL=fatal pnpm exec tsx scripts/benchmark-phone-reliability.mts \
  --baseline c433069cd0a7231b5f5aa07bb1c78f99b95a1f82 \
  --repeats 3 --output /tmp/phone-reliability-replay.json

# 需要已启动的专用本地模拟器、ZHIPU_API_KEY；会产生真实模型费用。
XOPC_PHONE_REAL_MODEL=1 \
XOPC_PHONE_BASELINE=c433069cd0a7231b5f5aa07bb1c78f99b95a1f82 \
XOPC_PHONE_EMULATOR_SERIAL=emulator-5554 \
XOPC_PHONE_EVIDENCE=/tmp/phone-reliability-live \
pnpm exec tsx scripts/benchmark-phone-reliability-live.mts

XOPC_LOG_LEVEL=fatal pnpm vitest run src/phone/__tests__ \
  src/gateway/hono/routes/__tests__/phone.test.ts \
  src/gateway/hono/routes/__tests__/phone-dependencies.test.ts \
  src/runtime-tools/__tests__/phone-dependencies.test.ts \
  src/runtime-tools/__tests__/phone-dependency-catalog.test.ts \
  web/src/features/phone/__tests__ web/src/features/settings/phone/__tests__

pnpm run typecheck
pnpm run build
```

真实脚本限制为本地模拟器和 Settings 导航，每次运行最多 8 次模型调用、整套最多 32 次，整套有 5 分钟截止时间。不能并发对同一设备运行两份测试。

**7. 结果边界与后续验证方向**

已验证的是具体机制改善、真实输入替换和完成证据质量；尚无足够数据证明跨 App 的总体成功率提升。当前原生观察来源通常只返回应用窗口，系统时钟豁免在真实设备上的收益仍需轨迹验证。当前仍保守处理任意应用文本变化，不能为了提高完成数忽略商品、收件人、价格等上下文。原生树无法完整表达的自绘界面或同树视觉覆盖层仍需要后续视觉/区域验证。

`requireChange` 表示本次观察到语义 UI 变化，不证明目标字段或业务后端一定发生相应变化；文本匹配是 UI 证据。结构化默认 insert 只验证目标字段包含文本；replace 才要求最终准确值。输入期间焦点丢失或应用主动关闭输入框仍可能需要人工确认。

本次没有训练模型、扩大默认动作预算、增加 HDC/iOS、引入多模型自动 fallback，或实现基于 elementId 的执行协议。通用页面自适应等待、可执行多条业务约束的专用验证器，以及多 App 的 20～30 类任务基准属于后续工作；本次已提供可重复脚本作为扩展入口。

**8. 最终检查记录**

- 26 个相关测试文件、190 项测试通过，覆盖 phone、鉴权路由测试、依赖管理和 Web 手机功能。
- 根目录 `pnpm run typecheck` 通过。
- 定向 ESLint 通过，`git diff --check` 通过。
- 完整 `pnpm run build` 通过（Node、类型声明、Web；含浏览器扩展构建）。现有的大 chunk 和动态导入建议仍会出现，不影响构建成功。
- 实际驱动输入替换三项通过；未执行真实发送、购买、账户登录或其他业务副作用。
- 临时状态与模型注册独立于用户配置；本次未推送、发布或自动扩大设备访问范围。

参考：[Open-AutoGLM Agent 循环](https://github.com/zai-org/Open-AutoGLM/blob/86f55382982fb054e8fc98ca80609dff8a2cdc3c/phone_agent/agent.py)、[提示与纠错规则](https://github.com/zai-org/Open-AutoGLM/blob/86f55382982fb054e8fc98ca80609dff8a2cdc3c/phone_agent/config/prompts_zh.py)、[动作执行](https://github.com/zai-org/Open-AutoGLM/blob/86f55382982fb054e8fc98ca80609dff8a2cdc3c/phone_agent/actions/handler.py)。

**真实 App 续轮验证**：后续两组候选没有改善真实完成率，已撤回；完整负面结果、失败定位和当前生产恢复状态见[真实 App 续轮报告](phone-use-real-app-optimization-2026-10-24.md)。
