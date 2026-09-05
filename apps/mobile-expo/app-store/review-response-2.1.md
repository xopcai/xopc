# App Review response — Guideline 2.1 information request

Use this response for submission `18e7913c-f7f8-498b-92ac-057341c5925f` after attaching a screen recording captured on a physical iPhone running the latest available iOS. Add the same information to **App Review Information → Notes**. Keep the dedicated password only in App Store Connect.

## Recording checklist

Record one continuous video on a physical iPhone. Do not edit the recording in a way that hides transitions or failures.

1. Begin on the Home Screen and launch xopc from a terminated state. This must be the first demonstrated action.
2. Open the pre-pairing privacy and data-sharing information, then return to pairing.
3. In Safari, open `https://tf.xopc.io`, enter the dedicated review password, and choose **Connect phone**.
4. Copy the fresh pairing link. Return to xopc and use **Other options → Paste pairing link**.
5. Show the six-digit confirmation code in xopc, return to Safari, confirm the same code, and approve the device.
6. Return to xopc and show the connected workspace with synthetic data.
7. Open a sample note and create or edit a task.
8. Start an assistant conversation. Show the recipient disclosure, choose **Agree and continue**, submit a simple request, and show the response.
9. Open **Settings → About → Privacy and data sharing**.
10. End by briefly showing **iOS Settings → General → About** so the physical device and current iOS version are visible.

The app has no publisher account registration, publisher account login, public user-generated-content feed, paid content, purchases, or subscriptions. State that these flows are not applicable rather than trying to demonstrate them.

## English response

Hello App Review Team,

Thank you for your review. We have tested the submitted build on a physical iPhone running the latest available iOS. We have attached a continuous screen recording that begins with launching the app and demonstrates the normal setup and usage flow.

### 1. Physical-device screen recording

The attached recording shows:

- launching xopc from a terminated state;
- viewing the privacy and data-sharing information before pairing;
- opening the dedicated review gateway in Safari;
- creating a fresh, single-use pairing link;
- pasting that link into xopc, comparing the six-digit confirmation code, and approving the device;
- opening a sample note and creating or editing a task;
- starting an assistant conversation, reviewing the named data recipients, providing consent, and receiving a response; and
- opening the privacy and data-sharing controls in Settings.

xopc does not provide publisher account registration or publisher account login. Pairing grants a device access to a gateway that the user operates. The app has no public user-generated-content feed, paid content, purchases, or subscriptions, so account deletion, content reporting/blocking, and paid-content flows are not applicable.

### 2. Purpose and target audience

xopc is a native productivity client for individuals and technical users who run and administer their own xopc gateway. It lets them access their private workspace from an iPhone: capture and review notes and files, manage tasks and scheduled work, continue conversations with an AI assistant, and inspect gateway connectivity. The app solves the problem of securely accessing a self-hosted assistant and workspace while away from the computer running the gateway.

The app is free and is intended for the general public. It is not restricted to a specific company, organization, or its employees.

### 3. Setup and access instructions

For App Review, we provide an isolated gateway containing synthetic data:

- Review URL: `https://tf.xopc.io`
- Username label: `reviewer`
- Password: provided in the App Review Information credential field

Steps:

1. Open the review URL in Safari and enter the review password.
2. Select **Connect phone** to generate a fresh pairing link. The link is single-use and expires after 10 minutes.
3. Copy the link, switch to xopc, and select **Other options → Paste pairing link**. Scanning the QR code from a second screen is also supported.
4. Compare the six-digit code shown in xopc with the code shown by the gateway, then approve the device in Safari.
5. Return to xopc. Open a sample note, create a task, or start an assistant conversation.
6. Before content is submitted to configured AI or speech services, xopc displays the named recipients and asks for consent.

No sample file is required. The review gateway already contains synthetic notes, tasks, and conversations and will remain available throughout review.

### 4. External services, tools, and platforms

- The user-selected xopc gateway provides workspace storage, synchronization, task management, automation, and assistant orchestration. Production users run and administer their own gateway. `tf.xopc.io` is an isolated gateway supplied only for App Review.
- AI, speech, image, and search providers are configured by the gateway owner. Before the mobile app sends content, it retrieves and displays the names and destinations of the services currently configured by that gateway and asks the user for consent. The dedicated review gateway includes functioning AI services so App Review can exercise the conversation flow.
- `link.xopc.ai` hosts the Universal Link association and the pairing-link fallback page.
- Apple Push Notification service and Expo's notification delivery service may be used for optional notifications.

The app contains no advertising network, cross-app tracking, payment processor, publisher-hosted user-account service, or analytics service.

### 5. Regional differences

The app functions consistently in every storefront where it is available. There are no regional feature or content differences. China mainland is not included in the initial distribution territories.

### 6. Regulated services and protected material

xopc does not operate in a highly regulated industry and does not include licensed or protected third-party media. It is a general-purpose productivity client for a user-operated gateway, so no regulatory authorization or protected-content license is applicable.

Please let us know if any additional information is required.

Best regards,  
Qiaomin Xu
