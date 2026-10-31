# D1独立desktop认证与D2客户端基础

D1服务端通过真实认证入口和安装包内Gateway E2E，D2只完成未接入UI/执行器的身份、签名传输和恢复基础类。**原生safeStorage、原生同意界面及只读Host尚未验收。**

- `p2a2-desktop-device-auth-pinned-client-1.json`：实际安装包Gateway `f962f15912f8f5ba8944894b22d58c679b125bf7858c0f1d23c38ea5ae857164`，Node监督器中的客户端在每次认证请求前核验固定Gateway签名。验证拒绝同意时不创建配对，完成/刷新响应丢失后跨客户端实例恢复原意图、刷新串行执行、撤销后不自动重新登记。客户端加密为测试注入AES-GCM，不冒充OS安全存储。
- 同报告验证请求重放拒绝、独立最小scope、手机/浏览器/Endpoint/Realtime/聊天及管理路由拒绝、自撤销和聊天不受设备撤销影响。没有注册任何Endpoint、截图/文件/命令能力。
- `p2a2-d1-installed-local-1.json`：同包本地新启动/复用，聊天、Cookie/WS、文件边界、PTY、浏览器、拥有进程重启及外部复用进程保留均通过。
- `xopc-p2a2-d1-regression-3.log`：170项相关服务端/数据库回归，包括v202–v262升级和v217整合基线，以及v262已配对设备、访问/刷新凭据、待批准请求逐行保留；完整性与外键通过。另4项新路由测试和4项身份加密/绑定/失败关闭测试通过。
- `p2a2-local-main-graph-1.json`：本地preload字节保持原值；main主体忽略导入chunk摘要后相同。共享设备契约/schema263改变chunk摘要，不能声称整个main仍逐字节相同或性能通过。

失败证据完整保留：首轮D1 CHECK约束错误后新增v263升级；初次刷新恢复测试误要求access token也相同，核对现有协议后改为验证稳定refresh token及有效access token；客户端Content-Type大小写重复造成签名拒绝，规范化请求头后真实入口通过；打包缺少重建后的Web产物和测试驱动CJS/ESM导入问题亦留档。没有放宽认证、重放、恢复时限或性能预算。

当前安装包为Developer ID签名macOS arm64内部测试，尚无公证/其他平台发布结论。v263不能由旧v262程序直接打开，回退需使用离线备份恢复流程，不允许降低schema版本号或删除数据库。
