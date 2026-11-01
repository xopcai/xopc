# 远端目录与可恢复缓存归档

新增目录进入/上一层、按会话工作区核验space与父路径、只传不透明资源ID的浏览入口。继续复用真实认证files API，无新路由；远端路径只交给固定上游files API，不用于本机文件或PTY。一次显示最多100项、解析上限1000项，当前不是大目录分页或大文件传输。

同步的加密文本副本可显式归档并恢复；活动缓存仍最多20项、每份32KiB，归档最多200项。原密文在同一Gateway命名空间移动并同步目录，不删除服务器文件、不自动回传。dirty/conflict/uploading/unknown副本不可归档；恢复不能覆盖活动ID或越过原活动配额。归档不是清除未知结果的入口，不跨Gateway恢复。

源代码7项/2文件及Electron类型检查通过：`/tmp/xopc-p3e-directory-cache-tests-1.log`、`/tmp/xopc-p3e-directory-cache-typecheck-1.log`，覆盖实际认证Gateway目录浏览、错误目录拒绝、加密归档、重启恢复、Gateway隔离、配额与未知结果保留。

[安装包原生整轮](./native-1.json)首次通过：实际进入子目录并读取、返回根、归档与恢复同步副本、原生取消回传/批准/冲突/丢响应，unknown副本不能通过UI或Main入口归档，密文校验和A/B身份隔离通过；同时完成原远端聊天断线/丢回执/进程重启恢复。命令：`node scripts/verify-electron-remote-chat.mjs --app /tmp/xopc-p3c-terminal-delivery-3/native/xopc.app --remote-files --remote-file-management --output reports/p3e-native-directory-cache-1.json`。该包也完成PTY Native与本地新启动/旧266 Gateway复用验证，详见相邻terminal-wire证据；所有测试均为私有夹具、同机独立服务器、确定性推理，不冒充WAN或实际模型。

原包1431文件/指纹`29e1a7cd0d7f2f599fd68b8d7a733007dd9035f3af2b1a1e52decccda32feb5b`，Native副本`af6a3e9f0eded13f97eba6c942209274c7981b4ac5be340a81aa613135d69193`。阶段预览，不是最终main安装包。二进制/大文件、分页、隔离卷管理与配额、Browser/Computer及P4仍待完成；原预算、性能失败与长测保留。
