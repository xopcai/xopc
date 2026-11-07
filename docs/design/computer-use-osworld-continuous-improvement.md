# Computer Use 持续优化方案：OSWorld + 原生验收

日期：2026-11-07。默认评测模型：`openai/gpt-6.1-sol`（GPT‑6.1）。

## 目标与执行边界

每轮优化必须有固定任务、独立结果判定、失败证据和同条件对比。
成功率提高必须同时检查误报成功、重复输入、接管、耗时和成本。
模型、提示词、执行策略、驱动分别记录版本，一轮尽量只改变一个因素。

采用两条证据链：

| 证据链 | 执行路径 | 能证明的能力 |
| --- | --- | --- |
| OSWorld | 官方任务初始化 → xopc 共用模型适配器 → 固定动作转换 → VM → 官方 evaluator | 当前观察、动作协议和短任务规划能力 |
| 原生产品 | xopc Agent → computer_use → Runtime → Broker → endpoint → macOS/Windows Driver → 独立 oracle | 实际产品规划、权限、状态重验、输入、恢复和停止 |

首期 OSWorld 使用 Python agent 接入共用 TypeScript 模型适配器。
该路径没有经过产品 Broker、Electron、原生 Driver 或完整主 Agent；不能据此认证这些部分。
官方 VM 中的全屏输入与产品单窗口后台输入也必须分别记录。
模型的 finished/success 只是声明，最终得分由官方 evaluator 产生。
不把未测量的安全计数写成 0，不把 OSWorld 原始得分转换成产品 betaGatePassed。

## 版本与样本

- 首期固定 `xlang-ai/OSWorld` 的 commit，任务 JSON 逐个 SHA256 校验；选择版本由 suite 文件记录。
- 使用 screenshot + accessibility tree；不混合 screenshot-only 成绩。
- 开发集 24 个任务，每类 3 个；留出集每类 1 个。包含浏览器、文档、表格、演示、图像、视频、编辑器、系统操作。
- 留出集在完成开发集优化后再跑；不把留出任务内容加入模型提示词或 flow hints。
- 首次接通可用 2 个开发任务 × 1 次冒烟；正式基线和候选都用相同的开发集 × 3 次。
- 每次重新初始化 VM 和 agent。固定镜像/快照标识、分辨率、观察模式、动作空间、最大步骤数、每步等待及模型输出预算。
- 网络/账号/初始化失败单列，保留完整计划分母。中断和缺失运行不能静默当作完成。
- 固定 GPT‑6.1；连接失败时停止，不改用其他模型。授权配置就绪后才开展模型实测。

## 持续迭代流程

1. 保存 baseline：Git revision、是否 dirty、suite fingerprint、模型引用、环境标识、每次运行的官方得分与轨迹。
2. 根据失败轨迹归因：定位、观察过期、输入协议、无进展循环、规划遗漏、状态丢失、提前结束、环境故障。
3. 选重复出现且影响最大的一个原因；先补能复现问题的离线回归，再修改共用实现。
4. 同环境、同模型、同预算跑 candidate；报告逐任务 wins/losses/ties，以及成功率、原始得分、步骤和耗时变化。
5. 新增退化必须查看轨迹。开发集改善后跑留出集和原生链路验收，才决定保留修改。
6. 把生产问题脱敏后加入独立产品任务集，避免只适应公开题目。

每个优化记录：问题、证据、假设、修改、离线验证、在线配对结果、原生验证和遗留限制。
在线授权或环境缺失时，明确标注“未运行”；离线测试数不能充当任务成功率。

## 指标与门槛

| 指标 | 用法 |
| --- | --- |
| 官方 score / binary completion | 分别报告原始平均得分和 score=1 的完成率 |
| 误报成功 | finished 声明成功但官方 score<1；单独列出 |
| 配对 wins/losses | 相同 task + repetition 比较；缺失 pair 阻止通过 |
| 步骤、模型请求、耗时 | 观察效率和预算耗尽；不可用更高预算冒充策略改善 |
| token / cost | 未采集时为 null；不得估成零或依据未知价格计算 |
| 原生安全指标 | 使用现有 evaluation harness 独立采集；未知投递不重放 |

离线 CI：适配器协议、动作转换、评测分母、重复样本、环境可比性与退化门槛。
模型实测最初手动运行，授权和 VM 就绪后再配置夜间开发集任务。
发布前跑留出集与 macOS/Windows 原生矩阵。已有 60 × 3 / 90% 产品 beta 门槛保持独立。

## 分期交付

### 第一阶段：接通与离线优化（本次）

- 编写固定 suite、Python agent、JSONL 模型桥和顺序运行入口。
- 模型桥复用 `createComputerModelAdapter` / `predictComputerStep`，读取 xopc 已配置凭据，不复制密钥。
- 输入只接受固定动作结构，由本地代码生成 PyAutoGUI 语句；不执行模型生成的 Python。
- 每次 VM 动作后重新观察；传输失败中断本轮，不重放不确定输入。
- 修复跨平台键盘语义，消除 Windows/Linux 中 Backspace 与 Delete 的混淆和 macOS 快捷键示例污染。
- 为现有产品配对比较增加可选的严格回归检查入口。
- 完成离线回归；保留可直接复现的运行命令。

### 第二阶段：GPT‑6.1 基线与首轮实测优化

- 用户补好 GPT‑6.1 授权；确认 x86 VM 主机和干净镜像/快照。
- 先跑 2 题冒烟，检查独立判分、轨迹与中断清理，再跑 24 × 3 基线。
- 根据最高频失败确定首个策略改进；同预算重复 candidate，保留完整退化清单。
- 在原生产品链路重复对应场景，验证改进实际传递到用户路径。

### 第三阶段：长任务与产品验收

- 接入 [OSWorld 2.1](https://github.com/xlang-ai/OSWorld-V2/tree/osworld-v2.1) 的 Python task-class / 分段判分接口。
- 2.1 的代码、任务、资源、网站和镜像必须匹配同一 release；不能直接交给首期 V1 JSON runner。
- 增加跨应用状态保持、动态信息更新、结果核对和澄清行为；报告 partial score 与完整完成率。
- 建立按产品任务价值加权的内部任务集，保留公开基准作外部参照。

## 当前环境与实测状态

本机为 macOS ARM64，Docker 返回 `aarch64`；未准备官方 x86 VM，不能宣称 OSWorld 可运行。
2026-11-07，现有 ChatGPT OAuth 刷新返回 HTTP 403 / `unsupported_country_region_territory`。
用户已明确要求先不跑，后续补授权；不再尝试在线推理或桌面实测。
本次只能交付离线验证和执行入口；GPT‑6.1 基线、成功率提升和完整产品链路成绩待实测。

## 本次交付与验证记录

- 入口与命令：[scripts/osworld/README.md](../../scripts/osworld/README.md)。
- 固定任务与 SHA256：[suite.json](../../scripts/osworld/suite.json)，24 个开发任务和 8 个留出任务均通过离线校验。
- 共用适配器已修复 Linux Backspace 方向和 Windows/Linux 快捷键示例；不代表新增 Linux 原生驱动支持。
- 产品报告比较增加 `--check`，完整矩阵存在任务退化、误报成功、未知安全计数或中断时返回非零。
- 已添加 `.github/workflows/computer-evals.yml`，只运行离线协议、报告和共用适配器回归；尚未推送或执行 GitHub CI。
- 本地 Computer Use 相关回归：429 通过、9 个显式 opt-in 在线测试跳过；新桥进程测试另行通过。
- 新 Python 离线测试：20 通过。根目录（含 Electron）与 OSWorld 桥的 TypeScript 类型检查通过。
- 机器可读记录：[offline evidence](technical/evidence/computer-use-osworld-offline-2026-11-07.json)。

来源：[OSWorld](https://github.com/xlang-ai/OSWorld)、[2.1 release manifest](https://github.com/xlang-ai/OSWorld-V2/blob/osworld-v2.1/benchmark_releases/osworld-v2.1.json)。
