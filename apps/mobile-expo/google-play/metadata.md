# Google Play metadata

This file contains public listing copy and review instructions. Do not store live review credentials here.

## 简体中文

- 应用名称：xopc
- 默认语言：简体中文
- 应用类型：应用
- 类别：效率
- 定价：免费
- 是否含广告：否
- 目标受众：18 岁及以上；不是面向儿童设计
- 简短说明：连接你自己运行的 xopc 网关，随时使用笔记、任务、自动化与 AI 助手。

连接你的 xopc 网关，随时继续自己的工作区。记录和整理笔记与文件，查看任务进展，管理定时工作，并与自己配置的 AI 助手继续对话。

你可以按需附加照片、录制语音、朗读回答，或将其他 App 中的内容分享到工作区。提交内容前，xopc 会展示网关配置的 AI 和语音服务，并由你决定是否授权。

联网功能需要你自己运行和管理、且可通过 HTTPS 访问的 xopc 网关。扫描新生成的二维码或粘贴配对链接即可连接；配对需在网关端核对确认码并批准设备。

xopc 不提供托管账号、托管网关、购买或订阅。可用功能和数据处理方式由你的网关及其配置的模型、语音和其他服务决定。

## English

- App name: xopc
- App type: App
- Category: Productivity
- Price: Free
- Contains ads: No
- Target audience: Ages 18 and over; not designed for children
- Short description: Connect to your own xopc gateway for notes, tasks, automations, and AI.

Connect to your xopc gateway and keep your workspace with you. Capture and organize notes and files, review tasks, manage scheduled work, and continue conversations with the AI assistant you configure.

Attach a photo, record voice input, listen to an answer, or share content from another app into your workspace. Before content is submitted, xopc shows the AI and speech services configured by the gateway and lets you decide whether to authorize them.

Connected features require an xopc gateway that you run and administer and that is reachable over HTTPS. Pair by scanning a fresh QR code or pasting a pairing link, then compare the confirmation code and approve the device on the gateway.

xopc does not provide a hosted account, hosted gateway, purchases, or subscriptions. Available features and data handling depend on your gateway and the model, speech, and other services it configures.

## Public URLs

- Privacy policy (Chinese): https://xopc.ai/zh/privacy
- Privacy policy (English): https://xopc.ai/en/privacy
- Support (Chinese): https://xopc.ai/zh/support
- Support (English): https://xopc.ai/en/support
- Developer contact: lyxopc.ai@gmail.com

## App access for review

Select that some or all functionality is restricted. Enter the review credential only in Play Console.

Review URL: https://tf.xopc.io

Username/label: reviewer

Instructions:

1. Open the review URL in Chrome and enter the supplied review password.
2. Select **Connect phone** at the bottom of the gateway console to create a fresh pairing link. Links expire after 10 minutes and can be used once.
3. Copy the pairing link, open xopc, choose **Other options** and then **Paste pairing link**. A second device may scan the QR code instead.
4. Compare the six-digit code shown by the App with the gateway page, then approve the device in Chrome.
5. Open a sample note, create a task, and start an assistant conversation. Review the named gateway services and choose **Agree and continue** before submitting content.

The dedicated environment contains synthetic data and remains available throughout review. It exists only for review; production users operate their own gateways.

## Policy declarations

- Ads: No.
- App access: Restricted; use the instructions above.
- News app: No.
- Health app: No health features.
- Financial features: No financial products or transactions.
- Government app: No.
- Target audience: 18+ only; do not select an age group that includes children.
- Account creation: The publisher does not create or host an App account. Pairing is device access to a user-operated gateway.
- Generative AI: Yes. A compliant in-App reporting path for offensive AI output must be present before closed testing.
- Content rating: Complete the IARC questionnaire based on the shipped build; do not claim that configurable AI output is fully predetermined.

## Preliminary Data safety worksheet

The final answers must match the tested release and all configured SDK behavior. The App has no ads or remote analytics and uses encryption in transit. It transmits data only for user-requested App functionality, including to the user's gateway and, when enabled, Expo Push Service and Firebase Cloud Messaging.

Review these data types in the Play Console form rather than selecting “no data collected”:

- User content: messages and related conversation context, notes, files/documents, images, and audio selected by the user.
- Contacts: only contact details the user explicitly selects or approves for an assistant tool. Broad Android contacts access should be removed before release.
- Device or other IDs: device public key/display name and push token used for pairing, authentication, revocation, and notifications.
- App activity/diagnostics: local usage events are not uploaded by the App; Google Play may separately provide platform crash and ANR diagnostics.

Purposes are App functionality and security. Data is encrypted in transit. It is not used for advertising or sold. Optional attachments, microphone, contacts, clipboard suggestions, and notifications remain optional; pairing data is required for connected functionality.
