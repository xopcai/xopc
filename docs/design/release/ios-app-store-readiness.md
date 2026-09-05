# iOS App Store release readiness

Updated: 2026-09-05. Version 1.0 received a Guideline 2.1 information request. Apple requires a physical-device screen recording and six product/business-model answers before review can continue.

## Changes prepared in this release

- Privacy and data sharing information is accessible from About and before gateway pairing.
- Clipboard suggestions require opt-in. Explicitly pasting a pairing link remains available.
- Content writes, uploads, voice transcription, speech generation, workspace sync and agent actions ask for consent before transmission.
- Gateway `GET /api/mobile/privacy` reports potential model, speech, image and search recipients, including available fallbacks. It exposes names and sanitized origins, never API keys or URL credentials.
- Consent is scoped to a gateway and recipient revision. Withdrawal survives app restarts. Recipient changes require another decision; failed disclosure requests do not send content. Consent is checked again before approving a device tool.
- Cancelling a chat submission at the consent prompt removes that submission from the automatic outbox retry path.
- The previous speech-only consent dialog is replaced by the shared data-sharing flow.
- Release and upload scripts check the exported IPA's target versions, SDK, signature, production APNs, Widget App Group, Universal Links entitlement and packaged privacy manifests. GitHub retains the resulting `verification.json` with the IPA.

Deploy the gateway update before distributing the new mobile version: older gateways do not implement the disclosure endpoint, so content submission will remain blocked until they are updated.

## Product and privacy decisions required from the publisher

| Field | Status / required decision |
| --- | --- |
| Publisher / legal operator | Confirmed: individual developer 徐巧民 (Qiaomin Xu) |
| Private privacy contact | Confirmed: `lyxopc.ai@gmail.com`; do not use public GitHub issues for personal deletion requests |
| Initial storefronts | 174 current storefronts are selected, with future storefronts enabled. China mainland is intentionally unavailable for version 1.0 and can be enabled after obtaining an App ICP filing number |
| Business model | Confirmed: free, with no purchases or subscriptions; connects only to gateways operated by the user |
| Final privacy policy URL | Published at `https://xopc.ai/zh/privacy` and `https://xopc.ai/en/privacy`; the Simplified Chinese URL is configured in App Store Connect |
| Support URL | Published at `https://xopc.ai/zh/support` and `https://xopc.ai/en/support`; the Simplified Chinese URL is configured in App Store Connect |
| Provider practices | Confirm actual retention, training and subprocessors for any publisher-operated gateway; the app cannot infer contracts from a model identifier |

The in-app privacy explanation is implemented and the finalized bilingual publisher policy is public. Keep the public pages and App Store privacy answers aligned with the actual shipped build and service practices.

The dynamic recipient catalog is a disclosure of configured model/speech/image/search services, not a complete audit of arbitrary extensions, MCP servers, browser destinations, model proxy subprocessors or user-authored programs. Review the actual enabled integrations of a publisher-operated service, disclose them in its policy, and retain their existing action approvals. Withdrawing mobile consent stops future content submissions from this app; it cannot retract previously sent content or cancel existing server-side automation.

## Distribution signature finding

The successful [2026-09-03 TestFlight workflow](https://github.com/xopcai/xopc/actions/runs/33702819293) produced version 0.0.21. Inspection of that actual IPA found no signed APNs, App Group or Associated Domains entitlement on the main app, and no signed App Group on the Widget. Its embedded main provisioning profile authorizes production APNs and the App Group, but does not contain Associated Domains.

The build script previously archived with `CODE_SIGNING_ALLOWED=NO` and only signed at export. The fix archives with distribution signing and assigns each Release target its own profile through `with-ios-release-signing`. The IPA verifier rejects the old artifact.

Associated Domains was enabled for `ai.xopc.xopc` through the Apple API. A new main App Store profile was created with the existing distribution certificate; production APNs, App Group and Associated Domains were checked before updating `IOS_PROVISIONING_PROFILE_MAIN_BASE64` in `xopcai/xopc` (2026-09-03 02:57:57 UTC). Existing certificates and the old profile were not revoked. The Widget profile already authorizes its App Group.

Workflow run [33777734402](https://github.com/xopcai/xopc/actions/runs/33777734402) subsequently built and uploaded version `0.0.25` (build `1`). The retained verifier report passed all three signed bundles, iPhoneOS 26.5 SDK metadata, production APNs, Universal Links, the shared Widget App Group and 14 packaged privacy manifests. App Store Connect processed that build as valid. Version `0.0.26` (build `1`) was processed as valid on 2026-09-04 with the same minimum OS and exempt-encryption declaration, and is the build selected for App Store version 1.0.

The external group `Beta Test` currently has no testers. Invite approved website applicants after Beta App Review succeeds. The TestFlight description, feedback email and published privacy-policy URL were configured on 2026-09-04.

## Review gateway setup

Use a dedicated gateway with synthetic notes, files, tasks and conversations. Keep it reachable over public HTTPS throughout review and re-review. Avoid a gateway containing personal files, production credentials or internal infrastructure access.

The selected review console is `https://tf.xopc.io`. It uses one dedicated review password that Apple reviewers may share across review sessions. Store that password only in the private TestFlight Beta App Review and App Review Information fields, rotate it after review, and never commit it to this repository.

1. Update it to a version containing `/api/mobile/privacy`.
2. Configure the actual model/voice services and working credentials needed by the review scenarios.
3. Provide the reviewer a protected way to generate a fresh pairing code. The existing isolated gateway console's mobile access screen can do this; a separate review portal is another option if already deployed.
4. Enter that console/portal URL and its dedicated review credentials in **App Store Connect → App Review Information**, not in the repository.
5. Tell the reviewer to generate a fresh code for each new installation/device, then scan it or use **Other options → Paste pairing link** in the app. The existing codes are single-use and expire after 10 minutes; do not attach one static expiring code as the only access method. The current pairing flow also requires comparing a confirmation code and approving the device in the gateway UI: reviewer access must allow completing this step independently.
6. Verify the same instructions from a clean device outside the development network. Include iPad if it remains supported.

No review-specific bypass, long-lived pairing token or hidden fake response mode has been added.

## Universal Links

Hosting is deployed and verified as of 2026-09-03 03:11 UTC. Public DNS resolves `link.xopc.ai` to `199.193.127.67`. The HTTPS `/connect` page and `/.well-known/apple-app-site-association` both return 200 directly; the latter has `application/json` content type and matches the new distribution provisioning profile's application identifier. The earlier DNS/hosting blocker is closed.

Apple's CDN at `https://app-site-association.cdn-apple.com/a/v1/link.xopc.ai` also returns 200 with the matching application identifier and `/connect` rule. The local default resolver still failed during this check; origin verification used the publicly resolved address with the original hostname/SNI and full TLS certificate verification, without changing local DNS settings.

The deployed AASA is equivalent to `apps/mobile-expo/app-store/apple-app-site-association` (the deployed file adds an explanatory comment). Deployment, certificate renewal, protocol and rollback details are maintained in the adjacent `xopc-platform` repository at `docs/mobile-link-protocol.md`. The publisher reports certificate auto-renewal configured through the existing Nginx/Certbot deployment.

```json
{
  "applinks": {
    "details": [{
      "appIDs": ["73R6WF52UJ.ai.xopc.xopc"],
      "components": [{ "/": "/connect" }]
    }]
  }
}
```

The deployed bilingual `/connect` fallback page offers explicit copying of the pairing link. Inspection of the served script confirmed that copying preserves the fragment and removes query parameters, only runs after a click, and makes no network requests. The page sends `connect-src 'none'` and `Referrer-Policy: no-referrer` headers. The pairing payload remains in the URL fragment; do not move it into paths, query strings, analytics or server logs.

Still pending: install the corrected distribution-signed app and open a real test gateway link from Notes or another app. Verify automatic opening, fallback copy/paste, expiry and gateway-side approval on a physical device. Origin and Apple CDN checks do not replace this device test. This pairing page is not the publisher privacy policy or a provisioned review gateway.

## App Store Connect materials

### China mainland

China mainland is intentionally excluded from the initial version 1.0 storefronts. App ICP filing is therefore not a blocker for the current App Review submission. Apple reports a missing or invalid ICP filing number as a distribution blocker whenever the app is made available in that storefront.

- Before adding China mainland later, complete the mobile-app filing through a qualified network access/service provider and obtain the App ICP filing number.
- Use the individual developer's legal name as the filing operator where applicable. The App name, domain, Bundle ID/platform identifiers and Simplified Chinese metadata supplied to Apple must match the filing record.
- Enter the verified ICP filing information under **App Information → Availability in China mainland**. Apple submits this information with the next app version review and displays a verified filing number on the product page.
- The confirmed product does not provide a publisher-operated generative-AI service: it is a free client for user-operated gateways. Keep the store copy and reviewer notes precise about that boundary. Reassess licensing and algorithm/AI obligations before introducing a hosted gateway, public model service, paid digital capability, news, publishing, religious content or games.
- Complete any China-mainland account compliance item shown under **Business → Agreements → Compliance** for the individual account.

- Name, subtitle, description and keywords: start from `apps/mobile-expo/app-store/metadata.md`.
- Privacy policy and support URLs: publish completed pages and verify on an unauthenticated device.
- Screenshots: capture the actual Release build with synthetic content on the supported iPhone and iPad sizes. Cover workspace, notes, chat and tasks. Verify current screenshot slots in App Store Connect before exporting.
- Age rating: complete the current questionnaire based on unrestricted AI output and any linked content; do not infer a rating solely from the productivity category.
- App Privacy: published on 2026-09-04 using the answers below; keep it aligned with actual provider practices rather than assuming “Data Not Collected” from self-hosting.
- App Review Information: insert dedicated reviewer access and the steps from `metadata.md`.
- Account deletion: review again if adding publisher-managed account creation. Removing a paired device is not deletion of a publisher-managed account.
- Commerce: if selling digital capabilities or subscriptions, resolve the purchase flow and applicable storefront rules before submission.
- Export compliance: confirm the current `ITSAppUsesNonExemptEncryption=false` declaration against shipped cryptography and distribution countries.
- Distribution agreements, entity information and territory-specific fields: complete the applicable fields in the publisher's Apple account.

### App Privacy worksheet

“Collected” in App Store Connect has a specific meaning. Whether a category is collected, linked to identity or used for tracking must be answered for the actual publisher/partners, not simply because an API can access it.

| Data / purpose | Current flow to assess |
| --- | --- |
| User content: text, notes, files, images | Mobile → chosen gateway; relevant content may enter AI context, indexing, organization and scheduled work |
| Audio data | Recordings → gateway → configured transcription chain; answer text → speech chain |
| Contacts | Approved contact names, phone numbers, emails → gateway tool result → relevant model context |
| Identifiers | Device pairing public key/id, device name/platform; optional push token |
| Notifications | Gateway → Expo Push Service → APNs; inspect configured content previews |
| Usage / performance | Current mobile metrics are bounded local records in MMKV; verify no additional remote telemetry SDK is included in the submitted build |
| Diagnostics | Gateway request logs and provider logs depend on the deployment; audit actual fields and retention |
| Tracking | No advertising or cross-app tracking flow was added; verify all bundled SDK practices before answering |

For the submitted iOS build and the confirmed user-operated gateway model, use the following App Privacy answers:

- Data collection: **Yes**
- Data type: **Identifiers → Device ID** (the optional Expo push token)
- Purpose: **App Functionality**
- Linked to the user: **Yes** (Apple treats linkage through a device as identity linkage)
- Used for tracking: **No**

User content, photos, audio, contacts and pairing identifiers are sent only to the gateway chosen and administered by the user, not to a publisher-operated backend. Local usage/performance records never leave the device. Expo stores notification contents only long enough to deliver them, while the Expo push token is a persistent device-level identifier, so the conservative disclosure is Device ID rather than “Data Not Collected.” Revisit these answers if the publisher later operates a gateway, adds remote telemetry or changes the push provider.

## Validation gates

Checks completed on the 2026-09-03 working copy:

- Mobile lint and typecheck passed; 119 test files / 593 tests passed, followed by focused consent/request regression checks.
- Gateway typecheck, 7 privacy/scope tests and 16 agent-stream tests passed.
- A real manual-signing prebuild assigned separate Release profiles to the main app, ShareIntake and Widget. The temporary test signing settings were removed by a clean normal prebuild afterward.
- The Release simulator build succeeded after clean prebuild. On an iPhone 17 Pro / iOS 26.4 simulator, clean launch, the paste-link entry, pre-pairing privacy information, scrolling and returning to pairing were verified. Screenshots are in the local ignored `apps/mobile-expo/dist/ios/qa/` directory. An earlier build with signing disabled could not access secure storage; the normal simulator-signed build resolved that failure.
- The verifier rejected the previous production IPA for its missing production APNs entitlement, as expected. Version `0.0.25` then passed the artifact verifier, Apple validation and App Store Connect upload. App Store Connect also processed `0.0.26` (build `1`) as valid, and that build is selected for version 1.0.
- Live Universal Links hosting and Apple's CDN were verified after deployment; physical-device automatic opening remains pending.
- App Privacy was published with Device ID / App Functionality / linked to the user / not used for tracking. Store metadata, screenshots, reviewer access and free pricing are configured. Version 1.0 was added to an App Review draft and passed App Store Connect's required-field validation.
- App availability is configured for 174 current storefronts. China mainland is explicitly unavailable, so its App ICP filing does not block this submission; future territories remain enabled.
- App Store version 1.0 using build `0.0.26 (1)` was submitted on 2026-09-04 at 13:56 Asia/Shanghai. On 2026-09-05, App Store Connect submission `18e7913c-f7f8-498b-92ac-057341c5925f` was rejected under Guideline 2.1 as an information request for a new developer account with limited review history. Apple requested a physical-device recording plus the purpose, audience, access instructions, external services, regional differences, and regulated-content status. The prepared reply and recording checklist are in `apps/mobile-expo/app-store/review-response-2.1.md`.
- TestFlight physical-device checks remain outstanding. App ICP filing is deferred until China mainland distribution is planned.

```bash
pnpm run mobile:lint
pnpm run mobile:typecheck
pnpm run mobile:test
pnpm run mobile:test:stream
pnpm exec vitest run src/gateway/__tests__/mobile-privacy.test.ts src/gateway/security/__tests__/gateway-scopes.test.ts
```

Native generation and dependencies:

```bash
pnpm -C apps/mobile-expo exec expo prebuild --platform ios --clean --no-install
pnpm -C apps/mobile-expo run pods:install
```

For a signed release, use the existing `Mobile iOS TestFlight` workflow after the changes are committed and available on its selected branch. Follow `mobile-build-release.md`; local absence of a distribution identity does not mean the existing GitHub signing setup is missing. Do not create a release tag solely to validate an uncommitted workspace.

The verifier can also inspect an existing production artifact:

```bash
python3 scripts/apps/mobile-expo/verify-ios-ipa.py apps/mobile-expo/dist/xopc.ipa \
  --version "$(node -p "require('./apps/mobile-expo/app.json').expo.version")" \
  --report apps/mobile-expo/dist/ios/verification.json
```

### Manual device matrix

| Scenario | Required outcome |
| --- | --- |
| Clean launch, no gateway | Privacy information accessible; no automatic clipboard read |
| Camera refused | User can paste a valid pairing link instead |
| Expired / reused pairing code | Clear failure; new code works; no weakened token lifetime |
| First chat / voice / upload / sync | Recipient disclosure before content transmission |
| Decline or withdraw | No content upload; no automatic resubmission after restart; read/delete/cancel remain available |
| Change gateway / recipient / proxy | Previous decision cannot silently authorize a new recipient |
| Background or cancel during prompt | Content remains unsent; no stale approval |
| Gateway older than disclosure API / offline | Clear update/reconnect error; content not sent without disclosure |
| Contact tool | Data-sharing consent and per-tool confirmation precede contact access |
| Background read aloud | Audio and lock-screen controls work; stopping prevents further requests |
| Push | Real distribution build receives and opens notifications with production APNs |
| Share / Widget | Extension opens correct content and versions match main app |
| iPad / large text / dark mode | No clipped controls, inaccessible dismiss actions or unusable keyboard layout |

## Apple references

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Minimum SDK requirements](https://developer.apple.com/cn/news/?id=ueeok6yw)
- [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [Privacy manifests](https://developer.apple.com/news/?id=r1henawx)
- [App information and China mainland requirements](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
