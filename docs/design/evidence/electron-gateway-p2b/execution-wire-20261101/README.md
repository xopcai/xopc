# J2b-3 执行授权与可靠回执接线

2026-11-01，接续 `3ac0d47ff`。本批默认不启用原生写能力；实际 Gateway 集成使用隔离夹具执行器和批准，不替代 OS 安全存储/原生授权验收。现有本地入口继续直连并管理自己拥有的 Gateway 进程。

已实现内容与限制见[契约修订](../../../electron-gateway-p2b-contract.md)。原生执行 Host/UI、操作查询和人工核实、J3/P3/P4仍待后续开发，尚未合入main。

## 验证

- 310项/43文件：Endpoint、Realtime、连接及控制器回归。
- 81项/10文件：认证/观察/屏幕/执行授权、lazy映射、独立设备帧和真实HTTP/WS集成。
- 253项/41文件：完整SQLite存储回归、所有支持版本至267升级、真实历史数据、备份、完整性及回滚。
- 最后12项/2文件：设备级未知操作阻断、真实Gateway下发/可靠控制器/本机持久回执/返回核验、重复不重做、错误哈希和缺协商能力拒绝。
- 根/Electron类型检查通过。以上集合有交叉，不累加为独立总数。

`xopc-j2b-wire-observation-cas-1.log`保留首次撤销失败。实际原因是Node HTTP DELETE携带JSON时缺少Content-Length，请求体未完整传给服务端，签名摘要不一致；补齐实际字节长度后cas-2的62项通过，未削弱原断言或增加预算。此前控制器/类型修正过程的失败也保留。

阶段候选 `/tmp/xopc-j2b-wire-delivery-1/installed/xopc.app` 来自真实DMG只读挂载复制，1428文件摘要 `d5bc394e7bdf902a0f89a07471307026c3fdc5fc2083343ff8ff5567292dda81`；DMG `/tmp/xopc-j2b-wire-delivery-1/xopc-preview-arm64.dmg`，SHA256 `0d6ecd05687353a8b02db4bace02485aad3cbc2e1f9de2e0eef7d1c49eb889f2`。Developer ID签名，未公证；373包内资源、666运行产物字节验证通过。

安装后的本地新启动/旧schema266 Gateway复用、聊天、文件/PTY/浏览器IPC、进程所有权及重启通过；复用数据库保持266→266，外部Gateway退出后仍存活。真实跨包265→267升级及历史审计、备份0600/旧版本完整性通过。包内HTTP审计归属和默认desktop无执行权、设备签名授权GET/POST/DELETE、Gateway签名回应、旧观察清理不撤销新执行权、一次性批准不能重用均通过。

包内SSH-loopback远端聊天、A/B状态隔离、断网/gap不重投、进程/worker崩溃未知输入、丢回执恢复、身份/协议兼容矩阵和返回本地通过。包内实际Agent/HTTP/Endpoint图像流程（Node Host注入截图与测试加密、先取消再批准）通过，实际模型HTTP收到同哈希图片；不是本批新原生截图或公共CA/WAN验证。S5旧候选24小时长测独立运行，不当作新执行Host长测。

原预算SHA256仍为 `e752bb4b97f54e4713d8ecc8b6f8cd302d3e80d044099b0397dfe113d0f45746`。性能专项延期，失败与预算均保留。
