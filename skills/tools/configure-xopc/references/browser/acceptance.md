# Browser acceptance

The owner selects Chrome and starts the test in the panel. Read browser_setup get {setupId}.
If state is not verifying, follow the recovery rules below or explain the next product action. Never claim verification from
connection tests. For a verifying attempt, first discover the exact browser_use declaration
with tool_search({query:"browser_use",limit:1}) only if its declaration is not already present.
If the search says already loaded, call browser_use directly; it is not a permission refusal. Reading the
manual does not load a deferred tool. Then perform the following steps:

For recovery, use the persisted attempt and checks, not the earlier chat summary. If a test
already has a tabId/read check, do not navigate again: observe its session to obtain fresh
refs and continue only unchecked click/fill steps. If read/click/fill already passed, only
close and read verification_report. Never replay a passed click or fill. If the attempt is
expired, stopped, stale, or needs_attention, release its session first (the owner panel can
release even when browser_use is denied); recheck and let the owner start a fresh test.
Do not treat cancellation as permission to restart; wait for a new user request.

1. For a new attempt only, browser_use navigate to the exact attempt.fixtureUrl. The host pins the selected endpoint
   and uses an independent test session. Read “Read check: <marker>”.
2. Use the newest observation revision/ref to click the button named “Test click”. Check
   “Click passed: <marker>” in the returned observation; observe again if needed.
3. Use the newest revision/ref to fill “Test input” with exactly attempt.sample, without submit.
   Check “Input passed: <sample>”; observe again if needed.
4. browser_use close with attempt.sessionId, including after a failed step. Never operate another page during the test.
5. browser_setup verification_report {setupId}. Only completed, non-stale evidence with all
   checks including released proves success. The host records real browser_use receipts;
   a model-written summary or supplied check list cannot mark the test passed.

The test allows at most 12 actions in 120 seconds. The product does not widen normal Browser
policy. Report partial results and cleanup uncertainty. On success explain how to attach a
page and ask for a summary; individual websites may still require login or permissions.
