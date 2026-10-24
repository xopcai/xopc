# Phone dependencies

Inspect readiness dependencies before asking the user to install anything. The product's
Phone dependencies card downloads pinned official assets with checksum/version validation,
shows progress, supports repair and can use a verified existing installation. Installation
happens on the Gateway host, not necessarily the computer displaying this chat.

Local USB/emulator connections require compatible Android Platform Tools (ADB). A cloud
Aliyun direct ADB connection does not need a local ADB executable. scrcpy server supports live
video, continuous touch and Unicode clipboard input for either route. Without it, snapshots
and manual input remain available; do not mark missing video as a failed basic connection.

Let the owner click Install/Repair in the dependency card. Existing ADB can be selected with
an absolute host path and verified version. If managed installation is disabled, explain
that policy and use existing/runtime controls; do not shell-install around it. Downloads may
use a configured proxy or verified offline bundle in Runtime Tools. Do not replace system
ADB keys, kill the shared ADB server, install APKs, switch IMEs, disable security protections,
or claim the dependency is ready until a fresh host check passes.
