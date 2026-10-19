# Store plugin live acceptance — 2026-10-19

## Scope and outcome

Repeated the actual Store installation and account setup journeys against the local Gateway and console, using the owner's existing DingTalk and Feishu accounts. Both installation/account journeys and real conversation tool invocation passed. Feishu capability coverage remains partial: calendar access is denied by the provider's application permission configuration.

| Scenario | DingTalk 1.0.5 | Feishu 1.0.3 |
| --- | --- | --- |
| Install the public Store package through the console | Passed | Passed |
| Download and prepare pinned CLI resources from Store | Passed | Passed |
| Skip account authorization and enter plugin details | Passed | Passed |
| Show authorization-required status after skipping | Passed | Passed |
| Resume account connection from plugin details | Passed: existing qmdemo account | Passed: user scanned the user-login QR |
| Finish setup and show connected status | Passed | Passed |
| Real model conversation invokes the installed plugin | Passed: current-user read | Passed: current-user read, drive search, wiki list |
| Calendar read | Not included in this read-only rerun | Denied: missing `calendar:calendar.event:read` |

Package removal retained account data and credentials. Existing encrypted Feishu application/account files were preserved across the new package revision before exercising the actual user reauthorization flow. This rerun therefore validates returning-user reauthorization, not first-time application provisioning. No business data was created, modified, sent, or deleted in this rerun.

## Defect fixed

Saving fields for a CLI authorization method started preparation before starting the login command. The asynchronous preparation job could hold the setup lock and reject login. CLI field submission now performs configuration, then login; the existing post-login effect prepares and probes the connection only after authorization succeeds. Token/form configuration retains its preparation behavior.

A component regression test asserts the mutation sequence is exactly `configure`, `authorize`, without an intervening preparation job.

## Evidence and validation

Private screenshots, account migration backups, run metadata and logs are local under `/tmp/xopc-full-chain-20261019`; they are not committed. The DingTalk read assertion checks a successful business payload, not only Agent run completion. The Feishu harness excludes help, dry-run and transformed jq output from acceptance and requests unmodified tool results when the model uses codemode.

- Web regression: 15 tests passed across setup, plugin dialog, owned skills, and connector rows.
- Backend setup regression: 7 tests passed.
- Core and web TypeScript checks passed.
- Changed UI files passed ESLint; production web build passed.
- DingTalk live report: `dingtalk-read/result.json`, passed.
- Feishu live report: `feishu-live/result.json`, partial; user, drive and wiki checks passed, calendar check failed.

The first DingTalk conversation was cancelled by a concurrent plugin installation refreshing Agent runners. The acceptance conversation was rerun after installation finished and passed. Agent completion alone is not used as evidence of successful provider access.

## Remaining provider configuration requirement

Feishu user login succeeds and the user/drive/wiki operations return successful user-identity responses. The official CLI independently reports missing `calendar:calendar.event:read` for calendar agenda. Repeating user login does not supply an application permission that has not been granted. Calendar functionality is not accepted until the application permission is enabled through the provider's normal approval flow and the real conversation read is rerun. No permission expansion was performed automatically.
