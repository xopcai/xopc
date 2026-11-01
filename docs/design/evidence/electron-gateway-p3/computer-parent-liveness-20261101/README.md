# Computer 私有进程父进程存活验证

这是 P3d 远端控制开放前的独立前提验证，不代表 Computer 远端功能已实现或完整安装包验收通过。

使用隔离开发态 Electron 主进程，载入现有安装包内同一 SDK/driver。先检查既有 macOS 辅助功能与屏幕权限，不弹权限申请、不截图、不发送桌面动作。核实 daemon 是测试主进程的直接子进程后，仅 SIGKILL 测试父进程。确认私有进程在原 3 秒停止预算内消失。

第 8 轮通过，停止约 37ms，包摘要前后一致。所有早期测试脚本失败保留：第 1 轮使用安装包不支持的 Main 调试 API；第 2–4 轮测试入口导入/生命周期不兼容；第 5 轮 VM 不支持动态 import，修复为 Node 26 createRequire；第 6 轮在退出后读取 Playwright 进程句柄导致报告异常，原始日志 `/tmp/xopc-p3d-development-parent-liveness-6.log` 保留；第 7 轮拒绝遗留测试布局锁，核实 owner PID 已退出及精确 symlink 后清理。第 8 轮验证通过，未放宽任何停止预算，也未改动安装包 fuses。

待继续：独立远端 Computer grant、专用 Broker、动作日志和未知结果核实、安装包原生及网络故障矩阵。不能把 SDK 文档或本测试替代这些验收。
