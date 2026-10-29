# 配置流程修订：纯对话与 Agent 自动执行

> 2026-10-28：已补上取消、重置保护及仅人工步骤的安全弹窗与原对话续跑；真实 Browser / 云手机验收见[审查修复报告](browser-phone-setup-review-fixes-2026-10-28.md)。下文保留当日实现及阻塞结果。

日期：2026-10-25。本修订替代 2026-10-24 Browser／Phone 方案中的聊天配置面板和按钮流程。保留原有设置页面，聊天中不插入配置页、表单、选择卡或验收按钮。

用户说“帮我配置 Browser Use／Phone Use”后，Agent 检查现状、读取对应 Skill reference、复用已有配置，并直接执行可以完成的步骤。不是把每一步改写成文字后仍让用户操作设置页面。

## 自动执行与必要介入

| 场景 | Agent 自动处理 | 用户必须介入时 |
| --- | --- | --- |
| Browser Use | 检查安装和连接、准备或修复扩展／Native Host、启用扩展路线、打开安装页／目录、复查、发起并执行有界验收、释放控制 | Chrome 加载扩展、原生权限；多个候选 Chrome 或替换已运行驱动时确定选择 |
| Phone Use | 检查模型／依赖／设备、选择兼容且已有凭据的手机模型、启用功能、安装或修复托管 ADB／scrcpy、注册已发现且在线的本机设备、复用云连接、执行并检查有界验收、释放控制 | 手机连接／解锁和 RSA；缺少的密钥、OAuth／登录；购买云手机；目标不明确或确需更改既有权限时 |

介入时只提供一个准确的下一步与原设置页面的普通链接。用户返回原对话后，Agent 重新检查真实状态再继续。已有健康配置、已完成步骤与用户此前明确的设备选择都复用。

## 产品工具

- `xopc_use browser_setup`：`inspect/start/get/recheck/prepare/advance/open/begin_verification/release/verification_report/cancel`。准备和验收使用当前 `expectedRevision`；切换已有正常驱动需用户明确选择并使用 `switchDriver:true`。验收 URL 来自宿主，模型不能传入任意 origin。准备结果给出真实扩展目录。
- `xopc_use phone_setup`：新增 `models/source/configure/set_model/install_dependency/register_local/begin_verification/release`。`set_model` 仅修改当前助手的手机模型，不能改聊天模型或其他助手；已有健康不同模型需明确替换。安装复用固定版本、官方来源与校验机制；云直连不安装本机 ADB。
- 操作仍由领域服务、配置服务、模型注册表、依赖管理器和 Phone／Browser Runtime 执行，Skill 不直接改 JSON、SQLite、密钥文件或绕过产品工具执行安装脚本。

## 权限与恢复

自动配置权限来自当前宿主会话：已认证且有 `gateway.admin` 的存活 App endpoint，或本机交互 CLI。Realtime 断连、端点重连覆盖或撤销后旧授权不可复用；普通设备权限、模型伪造参数、后台任务不能生成安装授权。工具策略、应用访问范围和原生拒绝仍生效。

配置过程中密钥只进原有安全表单。使用现有登录无需再次手动输入密钥。不自动买云实例、改账单或为了完成验收切换供应商。

检查、准备、连接、模型操作、界面证据和释放分别报告。宿主打开系统页不算模型完成导航。临时模型服务失败最多在同一轮自动尝试两次，之后关闭并报告阻塞，避免循环创建测试。用户再次要求继续时检查旧控制后再开始。

## 验证

新增回归覆盖会话直接配置／准备／开始验收、伪造授权拒绝、模型修改仅限 Phone 路由、健康依赖复用、本机设备发现校验与权限保持、后台／非管理员权限拒绝、重连与释放、自动重试上限。

`verify-conversational-setup-live.mts` 通过真实 App 浏览器输入自然语言，使用 XOPC Cloud GPT-5.6 Sol，检查聊天中不存在配置 UI。Browser 验证生产安装器实际准备扩展与 Native Host，并输出正确目录，将加载 Chrome 扩展交给用户。Phone 验证自动启用、设置专用模型、绑定既有云手机、开始测试和释放；当前手机动作模型返回 HTTP 503，故操作验收仍未通过。

此前 10-24 的面板截图与验收记录保留为历史证据，不代表本修订后的交互。新的入口不依赖原配置面板。

本轮相关 144 项回归通过，根项目／Web 类型检查、Web Lint 和 Skill 校验通过。Browser 真实对话执行了 `inspect → start → advance → get`，生产安装器检查扩展与 Native Host 均已安装；仅留下 Chrome 自身加载扩展这一步。Phone 实测执行启用与手机模型绑定，聊天模型保持不变，云手机控制会话最终关闭；模型 HTTP 503 阻断了实际导航验收，因此未报告通过。

当前复跑入口：`XOPC_PHONE_REAL_MODEL=1 node --import tsx scripts/verify-conversational-setup-live.mts`。可用 `XOPC_SETUP_LIVE_SCENE=browser` 或 `phone` 单独验证。旧 `verify-phone-setup-live.mts` 转向当前的 Phone 纯对话测试；10-24 的 Browser 面板验收脚本仅用于对应历史提交。

结构化实测记录（历史产物已移入 Git 历史） · Browser 纯对话截图（历史产物已移入 Git 历史） · Phone 纯对话截图（历史产物已移入 Git 历史）

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
