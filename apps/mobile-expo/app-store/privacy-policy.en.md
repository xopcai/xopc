# xopc Mobile Privacy Policy

Publisher / operator: Qiaomin Xu (徐巧民)

Private privacy and deletion contact: lyxopc.ai@gmail.com

Effective date: September 4, 2026

## Scope

This policy describes the xopc Mobile application distributed by individual developer Qiaomin Xu (徐巧民). The app is free, contains no purchases or subscriptions, and connects only to gateways run and administered by users. The publisher does not provide app users with a hosted gateway, app account or mandatory AI cloud service. Gateways, models and other services selected by users have their own operators, privacy policies and data-handling responsibilities.

## Data and purposes

Device pairing sends a device display name, platform and public key to the selected gateway so it can identify, authenticate and revoke that device. The app uses secure operating-system storage for refresh credentials.

Messages, relevant conversation history, synchronized notes, tasks, files, attachments and approved tool results are sent to the gateway to provide workspace and assistant functionality. Depending on the gateway configuration, relevant content may be processed by AI models, search, image generation, transcription, speech services, or automatic organization and scheduled work. The app displays the configured model and speech recipients, including available fallbacks, before requesting permission to submit content.

Camera, photo, microphone and contact access are used for the associated features. Contact tools ask for approval and return selected or matching names, phone numbers and email addresses. Clipboard suggestions are disabled by default; enabling them permits reading clipboard text when the app opens or returns to the foreground. Explicitly choosing “Paste pairing link” reads the clipboard for that action.

If notifications are enabled, the app registers an Expo push token, platform and language with the gateway. Push notifications pass through Expo and Apple Push Notification service on iOS, and may contain previews configured by the gateway.

The app keeps preferences, cached workspace content, pending submissions, consent choices and up to 200 usage/performance events locally. The reviewed distribution build contains no remote analytics, advertising or third-party crash-reporting SDK. TestFlight itself may provide Apple crash and testing diagnostics to the developer while a beta build is used.

## Service providers and transfers

The publisher does not select or operate the gateways, AI, search, image, speech or other content-processing services configured by users. Users or their gateway administrators are responsible for selecting those services and reviewing each provider's privacy policy, processing locations, cross-border arrangements, retention and model-training practices.

If notifications are enabled, push tokens and notification content pass through Expo Push Service and Apple Push Notification service. When the `link.xopc.ai` pairing page is opened, the pairing payload in the URL fragment is not sent in the HTTP request. The page uses no analytics or third-party scripts and does not read the clipboard automatically. Hosting and certificate services may still process network connection information and operational error logs needed to serve and secure the page.

A self-hosted gateway may still use cloud providers. Proxies may use downstream providers. User-configured extensions, connected services and tools may access additional destinations; the gateway administrator is responsible for explaining those services. Do not submit sensitive content until you understand the gateway and provider practices.

## Retention and training

The publisher does not store users' messages, notes, files, audio, gateway credentials or AI content on a publisher backend and does not use that content to train models. On-device data remains until the user deletes it in the app, removes a connection, clears app data or uninstalls the app. The pairing page does not retain pairing payloads; necessary operational error logs are retained only as needed for site security and troubleshooting.

For independently operated gateways and providers, contact the relevant operator for their retention and training practices. This application does not make a blanket promise that all configurable providers retain no data or never train on it.

## Choices and deletion

You can withdraw mobile content-sharing permission in Settings → About → Privacy and data sharing, disable clipboard suggestions and notifications, and change system permissions. Withdrawal blocks new content submissions from the app; it does not retract content already received or stop already scheduled server work. Pause automations and ongoing work separately.

Use the corresponding workspace screens to delete content, revoke the device on the gateway, and contact the gateway operator for backup or downstream deletion. Uninstalling the app does not delete remote content. For data controlled by Qiaomin Xu, contact lyxopc.ai@gmail.com privately. Include enough information to identify the relevant interaction; the publisher may request reasonable proof that you control the affected account, device or email address before responding.

## Updates and contact

Material changes will be announced through this policy page, app release notes or an in-app notice. Users may request access to, correction of or deletion of personal data controlled by the publisher as provided by applicable law. Requests concerning user-operated gateways or user-selected services should be directed to their respective operators.

For privacy questions, contact lyxopc.ai@gmail.com. Do not post personal content or credentials in public issue trackers.
