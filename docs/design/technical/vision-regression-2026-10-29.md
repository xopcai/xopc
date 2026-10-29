# 红色图片误判排查（2026-10-29）

## 当前结论和限制

没有证据表明这次 Promise.allSettled 并行准备引入了图片颜色回归。关闭这一个并行点后的串行版本也复现错误。复现失败时，客户端发到 router.xopc.ai 的实际 HTTP JSON 中，PNG 哈希和解码像素正确；该 HTTP 响应的原始流中已经是错误颜色，Gateway 和 Realtime 没有把回复换成别的请求结果。

问题定位到云端推理链路边界，**尚未修复图片误判本身**。生产路由的只读使用记录确认，这批请求实际选择了 deepseek-flash，但本次没有采集生产 Router → DeepSeek 的请求字节，因此不能完全区分云端适配与模型在完整上下文中的理解错误。不应把它直接定性为模型随机性，也不应声称更换 await 顺序修好了它。

## 串行与并行对照

两个进程使用同一份配置、同一端口、同一模型 xopc-cloud/auto、thinking=off。每个样本使用新建临时会话，红蓝交替；会话随后归档。串行源码快照只把 direct-turn-helpers.ts 的并行准备恢复为串行，保留其余工程优化；因此本轮单独检查这个并行点，不能把数据称为所有优化的完整回退对照。

| 对照 | 正确 / 总数 | 失败 |
|---|---:|---|
| 串行准备 | 10 / 12 | 蓝 → 紫罗兰；红 → 白 |
| 并行准备 | 11 / 12 | 红 → 白 |

样本量不足以比较准确率，但可以确认误判不依赖该并行点。原先红 → 蓝的旧样本没有完整线级捕获，不能追溯证明它当时最后一跳的输入内容；这里保留该边界。

所有 24 次捕获中，红图 SHA-256 为 `0af39b98b9995e12e81db3974aff7a870ab8c1571a99735804c03d842ff882e0`，RGB 均值 `[255,0,0]`；蓝图 SHA-256 为 `92f993b37460a45476d5315d4a94e43373188ff3bf5190ed99f4a1d2a6bfd2d9`，RGB 均值 `[0,0,255]`。没有附件互换。所有失败的原始 HTTP 响应文本与 Realtime 收到的文本一致。

失败 trace：

- 串行蓝图：acf6baa037946f13aca225bc60833b57；云端 requestId c2181c78-0586-4437-8eb1-c84f0bcc234a。
- 串行红图：ee8b5326597c2afd04b4e33315df9f35；云端 requestId 8481aba7-4ad7-45ce-a592-91f72b0eee1e。
- 并行红图：6cbef6207120102ea7cb024688d72e7a；云端 requestId 858ab2e4-a0e0-4639-8204-3b062ea06cd9。

云端 requestId 根据该隔离、顺序测试窗口的使用记录时间关联，并从对应生产日志确认 providerModel；捕获器 id 是本地关联标识，不是云端 requestId。

## 其他验证

- 最小 SDK 请求绕过本地 Gateway：64×64 的红蓝图 12/12 正确；544×544 的红蓝图 12/12 正确。最小提示词不等同个人助手完整上下文，不能据此声称尺寸调整解决了问题，也没有添加图片放大补丁。
- direct-turn-vision.test.ts：同名附件、两会话并发、交错延迟，8 次并行准备输出与串行图片完全一致，核对哈希和 RGB。
- vision-transport.integration.test.ts：真实 AgentSession、真实 SDK HTTP adapter、本地模拟 SSE 服务，分别验证内存及 SQLite transcript 下红 → 蓝 → 红的当前图片序列，核对最终请求中的当前图片哈希和 RGB。模拟模型不用于证明识别准确率。
- 实测脚本现在把非预热样本的内容断言失败作为非零退出码；保存所有原始失败，再报告失败，避免仅 HTTP / run success 就通过验收。
- 未修改云端路由、模型选择或全局用户配置。未向原个人会话发送测试消息。

DeepSeek 的官方文档确认该模型支持 PNG/base64 输入，并说明小图会由服务端放大；文档没有承诺特定输入的识别准确率：[Vision](https://api-docs.deepseek.com/guides/vision/)。

## 证据和复跑

- [实时样本](evidence/vision-regression-ab-2026-10-29.json)
- [实际 HTTP 图片元数据、原始回复及最小请求结果](evidence/vision-regression-wire-2026-10-29.json)
- `XOPC_LIVE_LATENCY=1 pnpm exec tsx scripts/measure-gateway-response-latency.mts --phase optimized --vision-only --warmups 0 --count 12 --output /tmp/vision-new-run.json`
- `XOPC_LOG_LEVEL=fatal pnpm exec vitest run src/agent/embedded/__tests__/vision-transport.integration.test.ts src/agent/service/__tests__/direct-turn-vision.test.ts`

诊断预加载器只捕获带特定测试标记的合成请求，不记录认证头、原始提示词或完整用户图片。当前运行 Gateway 已确认没有加载该诊断器，健康检查 ready；临时串行源码快照已删除。后续需在云端推理入口继续采集最后一跳、用相同上下文做可控对照，定位后才能交付图片误判的真正修复。
