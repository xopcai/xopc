# npm 发布耗时排查与优化方案

日期：2026-09-27。分析对象：v0.0.334，提交 `a70da5e4c44f0ea3bd18ce27bd4062357d34c827`。

## 结论

npm 发布 job 的主要瓶颈是全量测试：35 分 40 秒，占 job 总耗时 38 分 29 秒的 92.7%。npm 上传仅 10 秒。整个 workflow 还串行执行 Docker 发布；历史 v0.0.333 的 Docker job 用了 45 分 39 秒，其中 ARM64 在 QEMU 下执行构建命令耗时 25 分 57 秒。

建议依次实施：发布测试四路分片 → 测试数据库夹具优化 → Docker 原生架构并行构建。先保留完整验证覆盖，优化执行方式。

## 证据与耗时

[本次 npm job](https://github.com/xopcai/xopc/actions/runs/36303669385/job/108575994602) 于北京时间 16:15:57 成功结束。

| 步骤 | 耗时 |
|---|---:|
| Install dependencies | 13 秒 |
| Build（Node、类型声明、Web） | 1 分 51 秒 |
| Install audio test dependencies | 14 秒 |
| Run tests | 35 分 40 秒 |
| Run skills regression tests | 3 秒 |
| Validate publish manifest | 1 秒 |
| Publish to npm | 10 秒 |
| 完整 npm job（含初始化和收尾） | 38 分 29 秒 |

Vitest：1,400 个文件通过、3 个跳过；8,143 个用例通过、12 个跳过。内部报告为 2,138.42 秒；与 Actions step 的差额为命令启动和退出开销。

按日志时间边界估算，unit 阶段约 7 分 46 秒，component 约 22 分 21 秒，integration 约 44 秒，最后一组 extensions/packages/scripts/web 约 4 分 47 秒。component 占测试墙钟时间约 63%。最后一组的 Web 文件执行耗时累计仅约 23 秒，却用了接近 4 分钟，提示导入、环境初始化和文件隔离开销也值得后续分析。

历史对照：

| 版本 | npm job | Run tests | npm 上传 | Docker job |
|---|---:|---:|---:|---:|
| [v0.0.332](https://github.com/xopcai/xopc/actions/runs/36212127950) | 26 分 33 秒 | 23 分 55 秒 | 9 秒 | 47 分 56 秒 |
| [v0.0.333](https://github.com/xopcai/xopc/actions/runs/36249519163) | 39 分 11 秒 | 36 分 02 秒 | 10 秒 | 45 分 39 秒 |
| v0.0.334 | 38 分 29 秒 | 35 分 40 秒 | 10 秒 | 排查时仍在运行 |

v332→v333 文件数只从 1,388 增至 1,396，但测试耗时增长约 51%；多个既有测试和构建步骤同时变慢，不能简单归因于新增用例。现有日志没有 CPU、内存、I/O 指标，无法进一步确认 runner 性能波动的具体原因。

## 原因一：发布没有采用 CI 已有的分片，测试并发也偏保守

- `.github/workflows/npm-publish.yml:51` 在一个 runner 上执行 `pnpm run test:all`。
- `.github/workflows/ci.yml:107` 已配置四路分片，命令为 `pnpm run test:all --shard=N/4`。
- `vitest.config.ts` 用 `sequence.groupOrder` 将 unit、component、integration、其他项目分为四个先后执行的阶段。
- component/Web 等项目的 `maxWorkers` 是 `30%`；标准公开仓库 Ubuntu runner 为 4 CPU，按本地 Vitest 4.1.5 的 `Math.round` 算法只分配 1 个 worker。unit 的 `40%` 对应 2 个。此次日志未打印实际 CPU 数，实施时应补充 `os.availableParallelism()` 和最终 worker 数。

同一提交的 [CI](https://github.com/xopcai/xopc/actions/runs/36303669387) 四个测试 step 分别为 9:41、10:31、4:26、9:43，说明四路分片具有实际收益，同时负载还不均衡。第 4 片失败，不能将这次运行当作完整通过的性能基准。

官方语义：[Vitest maxWorkers](https://vitest.dev/config/maxworkers)、[sequence.groupOrder](https://vitest.dev/config/sequence)、[GitHub runner 规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## 原因二：大量用例重复准备完整 SQLite 数据库

最慢文件包括：

| 文件 | 本次文件耗时 |
|---|---:|
| `src/session/__tests__/store.test.ts` | 45.62 秒 |
| `src/connectors/__tests__/connection-recovery.test.ts` | 44.39 秒 |
| `src/local-apps/__tests__/local-app-service.test.ts` | 35.15 秒 |
| `src/routing/__tests__/resolve-route.test.ts` | 31.04 秒 |

前两个文件的 `beforeEach` 都新建磁盘数据库。`src/storage/sqlite/schema.ts` 先加载 v165 基线，再迁移到 v223；`migrations/runner.ts` 对每步迁移分别提交事务，`connection.ts` 使用 WAL + `synchronous=FULL`。因此业务断言之前已经承担了重复迁移与磁盘写入成本。

本地隔离微基准（macOS、Node v24.16.0，5 次；不修改业务代码，不接触用户数据库）：

- 新库打开并关闭：536 / 543 / 522 / 476 / 480 ms，中位数 522 ms。
- 复制已关闭的空库，再打开并关闭：7 / 7 / 6 / 7 / 8 ms，中位数 7 ms。
- 仅说明夹具准备优化有价值；不能把约 75 倍的局部差异外推为 CI 或全套测试加速比例。CI 使用 Linux + Node 22，需单独验证。

稳定性问题：[CI 第 4 片](https://github.com/xopcai/xopc/actions/runs/36303669387/job/108575994585) 的 `automation-service.test.ts:735` 超过 5 秒。该测试循环生成 2,001 条 run，并逐条保存 result/delivery；`saveAutomationRun` 每次事务提交并执行保留数量裁剪。本次 npm job 中同一用例是 2.581 秒，具有运行环境敏感性。

## 原因三：Docker ARM64 模拟构建及缓存开销

以下来自已完成的 [v0.0.333 Docker job](https://github.com/xopcai/xopc/actions/runs/36249519163/job/108431017649)，不冒充 v0.0.334 的最终耗时：

- smoke 镜像构建和装载：5 分 43 秒。
- 多架构构建和推送：38 分 01 秒。
- ARM64 `pnpm run build`：1,557.3 秒；amd64 smoke 构建同一命令：113 秒，约 13.8 倍差异。
- ARM64 内部：类型声明约 400 秒、Web TypeScript 检查约 488 秒、Vite 打包约 540 秒。
- GHA cache 导出：321.4 秒，约 5 分 21 秒。
- `Dockerfile` 在安装依赖之前 `COPY . .`，任意被复制源文件的变化都会使后续依赖安装层失效。
- 多架构阶段中 amd64 有缓存命中，不能将 smoke 和正式构建一概认定为完全重复编译；可以优化的是流程、导入导出及缓存策略。

[Docker 官方文档](https://docs.docker.com/build/building/multi-platform/)明确说明模拟执行对编译和压缩等工作负载更慢。可使用原生 `ubuntu-24.04-arm` runner。

## 分阶段实施

| 优先级 | 改动 | 验收方式 |
|---|---|---|
| P0 | 抽出 CI/发布共用的四路测试 workflow；发布保留全部七个 Vitest project；构建、skills 回归、manifest 检查与测试并行；发布 job 等待全部成功 | 同一 SHA 比较测试 ID 集合及 pass/skip 数；任意分片失败时禁止发布；记录每片耗时、CPU、worker 数、峰值内存 |
| P0 | 将版本/tag 校验、已发布版本检查前移到轻量 preflight | 版本不匹配立即失败；已发布的 npm 包可跳过重复 npm 验证路径，但重跑 Docker 仍可继续；区分 registry 404 与网络/认证失败 |
| P0 | 输出每片 JSON/JUnit 结果并在失败时也上传；明确稳定性问题的修复 | retention 用例在 Linux 连续运行，保持原有裁剪与孤儿记录断言；测试超时不会被自动重试掩盖 |
| P1 | 增加测试专用空库模板：每个 worker/运行生成一次，完成 checkpoint 并关闭后，每个用例复制到独立目录 | 从 session、connection-recovery 开始对比；数据不串用；schema 变化自动重建；迁移/恢复/持久性测试仍从真实空库或旧版本库起步 |
| P1 | 为 retention 测试批量准备非关键前置数据，保留生产写入路径跨越保留阈值和清理断言 | 保留对 1,500 条上限、结果与投递记录关联的验证；如需外层事务，先确认不会改变被测事务语义 |
| P1 | 单独测量 CI worker=1/2/3；优先增加 component 到 2，再评估 Web | 以 Linux 实测时间、峰值内存、无超时为准；不要同时提高并发并去掉全部 groupOrder，避免难以归因 |
| P1 | Docker 拆成原生 amd64/arm64 matrix，各架构测试候选镜像，以 digest 汇总发布 manifest | 两种架构均验证 CLI、Gateway health 和所需原生依赖；正式版本/latest 标签指向测试过的相同 digest；缓存 scope 按架构区分 |
| P2 | Docker 调整依赖层：先复制 lockfile、workspace/package manifests、patches 和包管理配置，再复制源码；评估 lockfile 驱动的 fetch 层 | 只改源码时依赖层命中；保留 workspace 解析和必要 install scripts；测量冷缓存/热缓存，不只看命中率 |
| P2 | 比较 GHA cache `mode=max`、更小导出范围及 registry cache；检查 runtime 的 `.pnpm` 是否残留不必要依赖 | 比较恢复、节省构建、导出三段净收益；不直接关闭所有缓存；检查镜像尺寸和运行完整性 |

P0 的建议数据流：`preflight → [完整包构建与检查 || tests 1…4] → publish npm → Docker`。构建 job 输出包含类型声明的固定 tarball，发布前验证其来源 SHA 和校验和，然后发布该同一 tarball；不要把目前不生成声明的 `build:ci` 直接用于 npm 包。首次拆分也要审计测试对 `dist` 的依赖，确有需要的测试应下载同一构建产物。

P1 Docker 阶段可先在 npm 发布后并行构建两种原生架构；确认稳定后再把候选镜像构建提前，与测试并行。正式 Docker 标签仍等所有门禁以及 npm 发布成功后才更新。

## 目标与边界

- 第一阶段目标：npm 从约 38.5 分钟降至约 12–16 分钟。依据是同 SHA 四片中的最慢测试约 10.5 分钟，加初始化、排队、产物传输和发布；这是待验证目标，不是已实现结果。
- Docker 原生构建后，再以连续三次冷/热缓存结果制定总 workflow 目标；当前证据不足以承诺准确分钟数。
- 分片降低墙钟等待时间，增加并行 runner 数，不保证总 runner-minutes 同比例下降；数据库夹具优化才会减少重复计算。
- `pnpm publish --ignore-scripts` 已存在，本次没有再次触发 `prepublishOnly` 重跑测试和构建；无需将其作为当前瓶颈修复。
- 安装缓存已经有效，13 秒的依赖安装、3 秒的 skills 回归不是当前优先项。
- 发布目前不依赖同 SHA 的普通 CI 成功，本次 CI 红灯但 npm 仍发布成功。若后续复用已有 CI 结果，应校验精确 SHA、测试配置和全部成功状态，不能按分支最近一次绿灯跳过验证。

## 实施记录

实现沿用现有工具，没有增加生产数据库开关、兼容路径或新的依赖。

### 阶段一：发布门禁与四路分片

- CI 与 npm 发布共用 `.github/workflows/test-suite.yml`，保留全部七个 Vitest project。
- preflight 在构建前校验版本/tag 和 npm registry；仅 404 表示尚未发布，网络/认证/服务错误均阻止继续。
- 根据包版本选择 npm tag，手动从分支发布预发布版本也不会误用 latest。
- 完整包构建与测试并行；构建含声明文件，生成一次 tarball，通过当前运行的 artifact 与 SHA-256 传给发布 job。
- 发布 job 显式检查各依赖成功状态；已经发布的版本跳过 npm 重建，但仍允许 Docker 阶段重跑。
- 每片保存 JSON/JUnit 和 `/usr/bin/time -v` 资源指标，失败时也上传。
- 移除 CI 内重复的测试 job 定义及发布 job 中原有的串行验证步骤。

自查与验证：18 个预检测试通过；真实 registry 只读检查正确识别 v0.0.334 已发布；完整 `pnpm run build`、skills 回归、manifest 检查通过；tarball 内 CLI、Web、两处公开声明入口存在；`pnpm publish <tarball> --dry-run --ignore-scripts` 通过。Actionlint 与 ShellCheck 检查通过。使用当前 Vitest 的真实 sequencer 检查，四片分别覆盖 352/352/351/351 个文件，合计 1,406 个文件、七个项目，没有遗漏或重复。全量回归覆盖同样的 1,406 个文件：8,168 个测试通过、12 个跳过、零失败，本地墙钟约 535 秒。

### 阶段二：测试数据库与并发

- `test/sqlite-fixture.ts` 只供测试显式调用。每个隔离测试文件生成一次当前版本空库字节模板，每个用例写入独立数据库文件。
- 相比最初计划中的跨文件/跨 worker 缓存，采用文件内缓存，避免全局生命周期、锁和缓存版本失效处理；Vitest 文件隔离保证 watch 重跑不会复用旧模块模板。
- 已接入 13 个高耗时业务测试文件。已有库重开仍调用生产 `openXopcDatabase`；迁移、恢复、持久性测试的建库路径保持不变。
- 夹具验证当前 schema、外键、完整性、写入隔离与禁止覆盖已有数据库；生产连接的 WAL 和 FULL 同步策略不变。
- retention 用例批量构造前 1,999 条历史数据，再通过生产 API 写入第 2,000 和 2,001 条，验证阈值、保留最新 1,500 条及无孤儿结果/投递记录。
- 发现 task-follow-up 的“Docker 不可用”场景依赖本机 Docker 状态，改为明确模拟该命令失败，同时保留真实 Git 工作树操作。
- CI 使用 `VITEST_MAX_WORKERS=2`，保留原有 groupOrder；本地默认配置不变。当前 Vitest 项目内 maxWorkers 会覆盖根 CLI 参数，因此使用官方环境变量统一覆盖并打印配置。

本地测量（macOS / Node 24，仅作方向性验证）：session 文件约 22.49 → 1.09 秒；connection recovery 22.16 → 1.22 秒；local app 18.19 → 1.53 秒。同一组 135 个用例在 1/2/3 worker 下分别约 10.65/5.59/4.70 秒，全部通过。存储层 200 个用例通过；retention 边界用例连续三次通过。

补充 Linux ARM64 / Node 22 验证：容器限制 4 CPU、8 GiB，同一组 135 个用例在 1/2/3 worker 下的 Vitest 耗时分别为 15.40/11.26/8.70 秒，三组全部通过，也覆盖 retention 边界。先采用 2 workers，为其余大型测试留出资源余量。该测量与本机镜像验证部分重叠，仅作方向验证；真实 Actions 的耗时与峰值内存由每片资源报告记录，不能用这些局部数据替代完整 CI 基准。

### 阶段三：Docker 原生构建与缓存

- 删除 QEMU、单独的 smoke 构建以及随后再次发起的多架构构建。原生 `ubuntu-24.04` / `ubuntu-24.04-arm` 各构建一个候选 digest。
- 候选镜像逐个运行 CLI、SQLite、Sharp、ripgrep、silk-wasm、FFmpeg 与 Gateway ready 检查；仅测试通过后上传 digest。
- 汇总 job 只使用两种已验证的 digest 更新版本标签和 latest，再检查最终 manifest 的平台集合。
- registry cache 按架构分别存放，替换原有同一 GHA cache scope；远端缓存传输的净收益需真实 Actions 数据确认。
- lockfile、workspace 配置、patches 及 `web/vendor` 离线包先进入 `pnpm fetch` 层，源码随后复制并离线安装。store 保存在普通中间层，可随 BuildKit 缓存恢复，不依赖不会随层缓存导出的 cache mount 内容。实际构建发现并修复了 xlsx 本地 tarball 的复制遗漏。
- 清理所有安装链接和 `.pnpm` 后重新安装生产依赖；可选浏览器分支仍先保存再恢复 Playwright。
- 排除宿主机 `.pnpm`、移动端构建输出和诊断目录，避免本地构建上传无关产物；删除最终重复递归 chown；pnpm 与 packageManager 对齐至 11.9.0。
- Docker 使用 `build:ci` 生成运行时，npm 包仍使用完整 `build` 生成声明。

自查与验证：Linux ARM64 镜像实构建成功，运行时编译约 38.4 秒；源码/文档变化后 `pnpm fetch` 层命中，随后离线安装成功。生产依赖重新安装下载数为 0，确认 Vitest、Electron、tsdown、node-pty 开发包不再残留。镜像中 CLI、Gateway ready、SQLite、Sharp、ripgrep、silk-wasm、FFmpeg 检查全部通过；可选浏览器的 runtime-assets 构建通过，Playwright 模块可导入（未下载或启动 Chromium）。

本机 Docker Hub 元数据请求曾超时，验证使用已拉取的相同官方 Node 22 镜像本地别名，并使用内置 Dockerfile frontend；仓库镜像默认值没有改为本地别名。首次实际构建暴露的 xlsx tarball 遗漏已修复后重跑通过。

待真实发布运行验收：原生 amd64、GHCR digest/manifest 发布、远端 registry cache 冷/热缓存净收益，以及连续三次 Actions 总耗时与峰值内存。工作流已经加入对应镜像门禁、平台校验和资源报告。本次没有推送或触发 npm/GHCR 发布，12–16 分钟仍是待实测目标。
