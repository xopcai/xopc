# J2a 执行监督核心与预览构建

尚未完成全部方案，尚未合入main。当前提交位于origin/main之上，可以保持fast-forward；原始main工作区的未跟踪方案文档未被改动。最终合并条件和测试方法见[测试说明](../../../electron-gateway-testing.md)。

- `electron-4.log`：114项相关Electron测试通过，覆盖持久意图、重复调用、不可变参数、授权/期限、watchdog、本机停止、停止未确认阻挡和再次本机停止。
- `e2e-4.log`：5项集成E2E通过，包括实际子进程动作后崩溃、期限独立终止、停止未确认时不释放物理锁，以及状态/截图HTTP/WS链路。
- `typecheck-4.log`：根/Electron类型检查通过。`typecheck-1.log`保留ES2023库不包含Promise.withResolvers的失败；改用兼容的Promise构造，没有提高目标版本或测试预算。
- 发现并修复未确认停止后丢失worker引用的问题。现在仍保留执行器以允许再次本机停止，并将执行器已停止与操作结果未知分别记录；不把停止确认变成成功或自动放行新的写意图。
- `xopc-final-preview-build-1.log`：新内部预览包构建、Developer ID签名、371项资源与664项运行字节校验通过；未配置公证。
- `j2a-electron-preview-build.json`：DMG及应用摘要。构建时基线提交a68d3308a，新增监督器文件尚未接入应用启动/工具路径，不冒称该包具备远端写能力。
- `j2a-preview-installed-local-1.json`：新包实际DMG安装副本的本地spawn/reuse、聊天/流式、文件边界、PTY、浏览器、重启与退出隔离通过。
- 隔离启动器实际启动和复用已通过鉴权Gateway就绪验证；未进行自动原生批准。没有继承模型凭据，没有修改真实用户数据库。

原生来源选择/截图验收仍被Mac锁屏阻挡，已请求手动解锁。J2b协议与执行权接线、J3、P3、P4仍未完成，不能提前合入main后声称全部开发完成。S5长测单独运行，性能原预算/失败继续保留。
