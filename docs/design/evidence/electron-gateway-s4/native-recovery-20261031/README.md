# S4 原生恢复与完整功能复验

2026-10-31，基于 `22c9e8251`。**macOS arm64 内部技术预览的本批功能验证通过；性能未验收。用户随后明确要求先完成整体功能、后续统一优化性能，因此性能失败暂不阻塞功能开发。原预算和历史失败保持不变。** Windows、其他架构和正式公证渠道仍未验收，不声明完整发布条件已满足。

## 修复和排查

- 原生恢复使用独立 `BaseWindow` 承载原生 sheet，不依赖远端页面、preload或凭据；该窗口没有webContents。[Electron官方文档](https://www.electronjs.org/docs/latest/api/dialog)说明macOS无父窗口消息框会同步运行。本地main源码和构建字节未改。
- 先增加父窗口/销毁断言，保留3项失败的红灯结果，修复后通过；随后补充父窗口创建失败仍退出的回归。
- 恢复工具区分控制器等待点击与点击后的恢复：本次CUA控制窗口明确设为120秒，**选择后恢复仍为原30秒**，用单调计时，实际选择有主进程日志标记。等待点击不是恢复耗时，未以加长恢复预算取得通过。
- 原测试把未初始化的极简配置当作既有配置，正常本地启动补充语音默认值导致断言失败。现在通过包内CLI在独立临时目录准备完整的既有配置，保留自定义语言/时限与关闭的音频能力，再复制配置文件。准备目录随后删除；实际客户端目录在选择前仍无数据库/工作区。继续严格断言配置逐字节不变，没有删掉该断言。
- 恢复工具保留失败状态目录、选择、退出、新PID及启动日志；成功时清理。CUA在原应用退出后再次绑定可能启动默认实例，因此控制流程在点击后交由已运行的测试监督进程验证，避免反复绑定已退出的进程。

## 已通过

| 检查 | 证据 |
| --- | --- |
| 相关142项/12文件回归、Electron类型、标准lint | `xopc-s4-native-final-*`；lint仅5项既有warning |
| 签名打包与资源门禁 | 367必需资源、658个运行文件匹配，依赖58.25 MiB，原125 MiB上限不变；公证因缺配置跳过 |
| 缺远端HTML的真实原生恢复 | `s4-native-parent-choice-local-window.json`：实际点击、本地新PID、Gateway认证、原本地窗口/preload加载，约2783.70ms；选择前无本地DB/workspace，既有配置字节不变 |
| 新包本地spawn/reuse | `s4-native-final-installed-local.json`：聊天、Cookie/Realtime、文件边界、PTY、浏览器、重启及复用所有权 |
| 新包→两台Docker Gateway | `s4-native-final-docker-100.json`：100次正常输入（原先声明的5000ms间隔）、分页、停止、gap/45秒半开、丢回执、进程/worker崩溃、A/B隔离、实际返回本地 |
| 新包→独立服务器HTTPS/WSS | `s4-native-final-physical-https.json`：有效公共证书、实际DeepSeek、receipt、重开历史且恰好一次提交、无Host登记/客户端数据库或工作区 |
| 新包→独立服务器SSH转发 | `s4-native-final-physical-ssh.json`：同上，显式SSH loopback仍为远端 |
| 独立服务器审计/回收 | schema262、integrity=ok；Nginx恢复原摘要，停止隔离进程并删除目录和临时凭据，原18790服务PID3603089保持在线 |

正常包摘要为 `d6fcc7f9a148617cd9020bc798b4aaaa1a4798ac87d2f4698bba5a513aa41ef8`，1421文件；功能E2E前后一致。独立服务器使用同一Gateway bundle（SHA-256 `5473c956f62b8705df2bfb293044688aab4a6d13afff4323041a567bd75d3988`），不复用用户服务器数据库。故障包独立标记/ad-hoc签名，缺失HTML不修改正常包；不能拿故障包冒充正式分发产物。

## 性能待专项，未标通过

发现此前故障包PID33739自18:41起残留，GPU、Renderer和原生热键helper持续运行，与旧采样重叠。先记录进程与启动时间，再仅停止经过可执行路径核验的测试进程，未停止用户正常应用/Gateway。新增只读idle门禁，覆盖孤儿helper和包内CLI，忙碌时拒绝验收，不自动清理用户进程；实际忙碌拒绝证据和相应单测均保留。

额外代理诊断显示复用路径有系统代理解析，通常数毫秒、冷启动数十毫秒，不足以证明它是全部P95超标的原因，未为此修改本地路径。清理后10次诊断样本改善，但仍有尾部延迟；有插桩且样本不足，**不是预算通过证据**。原采样器、原S0基线与SHA、ready/API/RSS阈值都未改变。计划中的候选→对照→候选完整测量按用户指示暂缓，没有挑选通过样本。

## 失败和重跑

所有本轮失败JSON均保留，包括早期点击超时、配置样本准备和配置差异；后续的通过不覆盖旧记录。失败目录只含隔离测试数据，留在本机，未将带测试token的配置直接提交。JSON逐字符串脱敏并扫描实际模型凭据，原测量数组未改；文本日志只规范末尾空行。

```sh
node scripts/verify-electron-startup-recovery.mjs --app /absolute/path/to/marked-fault/xopc.app --interaction-timeout-ms 120000 --output reports/new-native.json
node scripts/verify-electron-acceptance-idle.mjs --app /absolute/path/to/test/xopc.app --output reports/new-idle.json
node --import ./scripts/electron-startup-probe.mjs scripts/verify-electron-local-connection.mjs --runs 10 --operations 100 --mode reuse --diagnostics --output reports/new-diagnostic.json
```

启动probe强制要求diagnostics且禁止compare，不用于正式预算。实际恢复测试需在对应控制窗口内用CUA选择本地模式；完成后以监督进程记录的配置、PID、认证与真实窗口日志验收，不再次激活已退出的故障实例。性能专项恢复时必须先结束构建、功能E2E和测试包残留进程，使用原采样器/原预算完整复测。
