# Continuous voice companion

The user approved one call entry, continuous voice context, selective natural Chat messages, independent speech interruption and task cancellation, and a 1500 ms first meaningful audio target.

## Implementation

- Keep raw speech as hidden, source-tagged transcript rows under the same stable conversation and active transcript. This is the durable voice side stream, not another user-visible Chat or an expiring in-memory side chat. Preserve evidence for corrections and memory learning.
- Render only explicit publications and real execution results in main Chat. Never synthesize user messages from model-written summaries. Publication is an assistant message with source identity and idempotency, not a new request to execute.
- Let the conversational model select substantial content using a narrow publication tool. Run it after a committed user turn; no additional foreground summarizer. The fallback Agent gets the same publication boundary.
- Persist native delegated task results independently of the call socket so hanging up cannot lose results. Suppress voice execution chatter in Chat.
- Choose a capable realtime engine automatically before dialing, falling back to the existing STT/Agent/TTS engine. Keep explicit engine overrides in advanced settings.
- Retain current playback cancellation and durable task cancellation semantics. Synchronize external Chat input into a running call without executing historical requests again.

## Verification

- Hidden voice transcripts survive reconnect and learning but do not render as messages in main Chat.
- Publications remain assistant content through UI, LLM projection and embedded hydration, and cannot duplicate on retries or cross a transcript reset.
- Native task results survive hangup; fallback small talk stays hidden; approvals and cancelled/failed outcomes stay accurate.
- One call action across Web, Android, iOS and HarmonyOS. Build the changed clients where toolchains are available.
- Measure real service first audio from speech end, separately from task submission and task completion. Record failures and any remaining misses against 1500 ms; do not substitute canned acknowledgement for meaningful response.

## Progress

- Repository analysis complete. Existing raw Omni rows are directly visible; existing side-chat runtime expires in memory and is unsuitable for durable voice execution.
- Implemented hidden speech and execution rows, selective `chat_publish` assistant messages, durable delegated results, publication idempotency/reset protection, and Chat pagination filtering. Raw exports and memory evidence remain complete.
- Implemented server automatic engine selection with an action-capable realtime route and pre-dial fallback; explicit overrides remain advanced. Web, Android, iOS and HarmonyOS now expose one call action. Removed a redundant status request from client connection setup.
- Implemented mid-call shared Chat/context updates without an automatic reply, plus restoration of running voice tasks after redial. Voice execution events use a private `voice-run` topic so they cannot render as main Chat chatter.
- Verification so far: 593 backend/Web checks passed (5 selective skips); later focused 70 checks passed after prompt changes. HarmonyOS 843 host checks passed. Android compile and focused voice protocol unit tests passed through the managed Gradle wrapper. iOS build and 11 voice protocol tests passed. HarmonyOS debug HAP build passed after supplying the installed SDK root.
- Real isolated Gateway (18795, fresh database and isolated workspace, channels disabled): three ordinary speech rounds produced zero visible Chat messages and retained six hidden speech rows. Explicit publication produced one assistant message containing the two requested suggestions, with two hidden speech rows. Delegated history lookup produced one visible real Agent limitation/result and five hidden execution rows. Explicit cancellation reached `cancelled` and preserved a Chat result.
- Latency is NOT accepted yet. Original social-chat sample: 1609/1614/1595 ms. Shorter instructions: 1826/1813/1547/1542/1530 ms. A 120 ms endpoint attempt caused `INPUT_DROPPED` and was reverted to 180 ms; transcription confirmation timeout increased from 900 to 1500 ms for availability. Explicit publication 1690 ms. Lookup action submitted in 1046 ms, first spoken response 2456 ms, terminal result 9863 ms; cancellation submitted in 1005 ms and terminal in 3448 ms. These are network receipt measurements, not acoustic playback or a production SLO.
- Redial/hangup verification passed: restored the same task after reconnect and cancelled it; hanging up without cancellation retained the eventual result. Four real-service identity scenarios passed again.
- Final stable 180 ms endpoint sample: 1535/1545/1571 ms (p50 1545 ms, p95 1571 ms, 0/3 within 1500 ms). Final action submitted in 1002 ms, first audio 1855 ms, terminal 9734 ms. A second 120 ms experiment with the longer confirmation deadline also dropped valid input, so it was rejected. Full evidence is in [the latency report](./ada-voice-latency-20261107.md).
- Added fallback result retention after real tool execution, deduplication against explicit publication, explicit long-result excerpt markers, native quiet-gap reporting of composed background replies, and coalesced context refresh that retains updates arriving during refresh. Backend/Web 647 checks passed; later private-topic 16 and refresh lifecycle 6 checks passed. Node/types/Web and incremental iOS builds passed. Android UI-test compilation passed (no real-device UI execution); managed Gradle finish cleaned only its owned logs.
- Product and runtime docs updated. Docs check is blocked by the existing unrelated missing device-host CLI overview entry. Main Gateway loaded the new default automatic route; actual Ada resolves to Boson/Higgs and its configured user name remains present. The final process was restarted after the last source change, authenticated ticket creation/cancellation selected Boson/Higgs for Ada, and its configured name remained present. The isolated Gateway and private diagnostic state were removed; native builds have not been installed on the user’s phones. Cleanup/reload evidence is in the latency report.
- The continuous companion feature is implemented; stable end-to-end 1500 ms latency is still unfulfilled. Do not describe the overall performance target as achieved.

- Browser production-component smoke passed with synthetic Chrome microphone and fake Gateway: complete PCM playback, reversible VAD ducking without raw-VAD cancellation, explicit clarification, stop/mute/navigation/mobile layout, automatic setting and dictation recovery. Additional entry/route regression: 75 checks passed. Neither test is a physical audio latency measurement.


## Cloud realtime picker correction

The Ada model picker previously listed only Higgs and the globally configured native model. The connected Cloud catalog did publish XOPC Cloud Realtime, but the global native selection was empty, so the model was missing from this picker. The settings response now includes all published conversation-capable Cloud models, and per-Ada route resolution can select them without changing global configuration. Model voices and tools continue to come from the published manifest; conversation-only models are labeled and automatic routing retains the action-capable fallback.

Targeted picker, catalog, route and automatic-selection checks: 35 passed. Web type check, related lint, Node/Web builds and diff formatting passed. The initial Core type check passed before concurrent Local App edits; the final aggregate recheck has unrelated BodyInit/Buffer errors in gateway routes and an unknown-to-JSONType error in the new notes organizer client. No failing diagnostic points to the voice-picker changes.

Concurrent Local App edits briefly lacked their generated starter bundle and the existing Gateway stopped during that period. After that work produced its required source and generator, the Node build succeeded and Gateway was restored from source. Authenticated GET /api/voice/boson now returns naturalModels with xopc-cloud/realtime, name XOPC Cloud Realtime, tools=false, while legacyModel remains null. GET /api/personal-agent confirms the existing boson/higgs-realtime selection and configured user name remain present. No preferences or user profile were rewritten by this correction.


## Cloud action parity

Platform relay/capabilities and the published Qwen 3.8 Cloud route now support the same four client functions as Higgs. Real isolated tests verified actual Agent find/read_file execution, a correct unchanged verification file, one visible result, playback interruption without task cancellation, and an explicit cancelled terminal outcome. Main catalog refresh reports tools=true and Ada's selected Higgs model/profile remain unchanged. Non-Higgs context refresh now keeps base instructions separate from enriched engine instructions. Partial realtime config patches retain sibling settings; the main parameters accidentally overwritten by the earlier auto-engine patch were restored from backup. Platform deployment/rollback and evidence are documented in xopc-platform/docs/design/cloud-realtime-agent-actions.md.

The 400 ms diagnostic silence experiment split input and timed out; it was rejected. Baseline first audio remained about 2.23–2.31 seconds at the existing 1200 ms pause setting. No 1500 ms claim is made.

- Cloud rollout finalization: loaded the last runtime/config fixes in the main Gateway; real partial-config HTTP PATCH preserved enabled/STT/TTS/native routes. Private diagnostic state and generated audio were removed. Production model-gateway source and compiled artifacts are aligned, with preceding versions retained for rollback.

## Redial conversation continuity

The same Ada conversation already persisted hidden voice turns and included them in canonical LLM history. The weak point was restoration: every provider connection started a new native conversation, while history was only embedded in the shared 8,000-character instruction budget. Persona, tools and memory competed with it, and a long assistant turn could crowd out preceding user constraints.

Native calls now restore a separate quoted conversation item, bounded to 24,000 characters, before reporting ready. Both Higgs and Cloud acknowledge the item; restoration does not request a response or execute old tasks. System instructions retain identity, tools and permitted memory independently. History packing bounds individual long turns and keeps their beginning/end so preceding user constraints remain available. Older omitted details can be recalled through the existing Agent/session_recall path; this remains bounded restoration rather than unlimited model memory. The visible Chat projection is unchanged. Reset still creates an empty active transcript.

Validation: all 268 native voice unit checks passed, including the seven runtime lifecycle checks. Fresh-store restoration and reset isolation passed. A paid Higgs test used two real upstream connections and synthetic speech: discuss Hangzhou with a 3,000-yuan budget, hang up, redial, and ask for the city/budget. Both facts were recalled and zero visible Chat messages were produced. Cloud restoration/acknowledgement is covered by the protocol tests; the optional Cloud live test requires Cloud credentials in its isolated test environment. Type declarations, Node build and related lint passed. This change adds no summarization model call and does not establish that the 1,500 ms latency target is met.

Protocol reference: [Boson client events](https://docs.boson.ai/api-reference/realtime/client-events) documents item creation/acknowledgement without triggering a response.

The main Gateway was restarted into a fresh process. An authenticated connection to the existing Ada conversation became ready after restoring context (no audio sent), then was closed normally. The active transcript ID, visible message count, stored row count and selected model remained unchanged. Connection readiness took 2,317 ms; this is setup time, not speech-end-to-audio latency.
