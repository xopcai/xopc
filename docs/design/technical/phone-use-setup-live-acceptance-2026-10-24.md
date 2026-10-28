# Phone Use 在线配置验收

> 2026-10-28：已使用当前兼容模型 `xopc-cloud/phone-doubao` 完成真实云手机五项验收，见[审查修复报告](browser-phone-setup-review-fixes-2026-10-28.md)。下文保留当日额度阻塞记录。

日期：2026-10-24。最终状态：**外部手机模型额度阻塞，完整操作验收未通过**。

对话引导全部使用 XOPC Cloud GPT-5.6 Sol，实际请求模型为 `openai-codex/gpt-5.6-sol`。手机动作模型独立使用 `xopc-cloud/phone`。最终两组证据共 83 次对话模型请求全部 HTTP 200；手机动作模型返回 HTTP 429、`free_quota_exhausted`，不是 GPT-5.6 Sol 对话失败。Cloud 当前仅公开一个支持 Phone 动作协议的模型，未自动切换供应商或开启计费。

## 实际执行结果

| 项目 | 结果 |
| --- | --- |
| 从“帮我配置 Phone Use”进入统一 Skill | 通过 |
| 渐进读取 SKILL → Phone overview → local／aliyun → acceptance | 通过，未读取 Browser 场景 |
| 本机模拟器发现、注册、连接、原生界面读取 | 通过 |
| 复用现有阿里云测试手机、私钥与连接 | 通过，无需本机 ADB |
| 云手机配置卡片选择设备、点击授权、自动续接原对话 | 通过，真实浏览器按钮触发 |
| 打开手机后中断模型，再重启 Gateway，从原对话恢复 | 通过，保留配置与尝试，不重放旧操作 |
| 失败后关闭与释放，并用独立会话重新取得／释放控制 | 两种设备均通过 |
| 真实动作模型导航到版本详情并以原生界面验收 | 未通过：免费额度已耗尽 |

修复后的最终检查，两种设备均为 `configured=true, read=true, operated=false, verified=false, released=true`。这是正确的未完成状态，不能把截图读取、宿主打开设置页或模型请求被拒绝算作模型操作成功。

## 本轮直接修复

- 明确 scrcpy 是视频和 Unicode 输入的依赖，不阻挡基础截图／导航验收；配置保存后按钮自动续接，不要求用户再额外回复“好了”。
- 刷新原对话后继续显示已绑定测试设备，测试中禁止更换目标。
- 使用 Android 标准关于手机入口，避免打开设置时保留旧的“系统”子页面；模型仍需实际导航到版本详情。宿主打开页面不计入六步模型预算，也不算模型已导航。
- 云手机普通原生界面树读取曾返回 `could not get idle state`，增加压缩界面树回退。真实设备单独复测取得 49 个节点，最终对话中的原生读取检查通过；没有修改系统动画、安装 APK 或替换 ADB 密钥。
- 将 `free_quota_exhausted` 识别为独立模型额度错误，保留上游重试等待信息，提示等待额度恢复或由用户在设置选择其他兼容模型。配置卡片明确无需重装 ADB 或重新授权手机，不立即自动重试。

## 验证与边界

186 项相关回归测试通过；根项目与 Web 类型检查、Web Lint、生产构建、Skill 校验及 `git diff --check` 通过。测试使用隔离 Gateway、SQLite、工作区和对话；日常设备配置没有被替换。

未验真实 USB RSA 弹窗、云手机购买与私钥轮换。额度恢复后仍需重新执行真实动作模型验收；本报告没有将尚未完成的导航标为成功。

[结构化证据](evidence/phone-use-setup-live-2026-10-24.json) · [原对话额度提示与释放状态截图](evidence/phone-use-setup-quota-recovery-2026-10-24.png) · [可复跑脚本](../../../scripts/verify-phone-setup-live.mts)
