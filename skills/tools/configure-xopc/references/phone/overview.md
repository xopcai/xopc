# Phone setup

Read tool_manual({tool:"xopc_use",topic:"phone_setup"}). Discover xopc_use if not already
loaded. Call mode phone_setup inspect, then start to create/reuse a setup in this conversation.
Inspect before asking questions; reuse healthy registrations and matching model configuration.
Read models.md only for missing/unsupported models, dependencies.md for missing dependencies,
then only the owner's chosen local.md or aliyun.md branch. Missing scrcpy only limits video
and Unicode input; it does not block the Settings screenshot/navigation acceptance. State this
when reporting dependencies instead of asking the owner to install an optional prerequisite. Load troubleshooting.md on refusal
or failure, acceptance.md only when the owner starts a test.

Explain outcomes: xopc can observe and operate the explicitly selected Android phone through
a dedicated action model. Chat model, Phone model, software dependencies, connection, actual
UI verification and release are distinct. A registered/enabled phone is not proof of a live
connection; describe it as registered until a connection check or actual PhoneRuntime operation
confirms it is online. Setup configuration is shared on the Gateway host;
a USB cable to the browser computer cannot connect a different remote Gateway.

Use the chat setup panel. The owner chooses local or Aliyun and the exact registered phone;
do not silently choose the first/default device or buy a phone. Configuration writes, downloads,
private-key upload, app access and paid tests remain in existing product controls. Model tools
can inspect/start/get/recheck/cancel/report; begin_verification returns the owner action.
After saving configuration, direct the user to “授权并开始安全验收” / “Approve and start safe test”
in this chat. That button sends the continuation itself; do not require an additional “好了”
message after the owner starts the test.
Do not write config, credentials, durable_state, Android keys or cloud account settings yourself.

A conversation may show other phone tasks: never replace or close those sessions. Setup uses
its own narrowly scoped test owner; cancellation and release operate only that test. If the
Agent's phone_use policy is denied, do not change identity or permission to bypass it.
