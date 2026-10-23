# Connect an Alibaba Cloud Phone to xopc

Use this guide for an existing, running Android cloud phone. Prepare its ADB endpoint and matching private key in the Alibaba console, then add it to xopc.

| xopc field | Where to get it | Example |
| --- | --- | --- |
| Phone name | Choose a label yourself | Alibaba test phone |
| ADB address | Cloud console connection details | `203.0.113.10:10001` |
| Private key file | Downloaded when creating an ADB key pair | `adbkey` |

The example IP is a placeholder. Alibaba AccessKey, account passwords and SSH keys are not required. Model API keys are configured separately under **Intelligence → Models**.

## 1. Open the phone's ADB panel

For Agentic Mobile, open the [node console](https://aim.wuying.aliyun.com/nodes), find your phone and open **ADB connection**. The following steps describe the panel with **Bind key pair** and **Create ADB connection**; labels may vary by console version.

For standard Cloud Phone, use the [Cloud Phone console](https://wya.wuying.aliyun.com/). Key management is generally under **Network and Security → Keys**, and the instance connection action may be called **One-click ADB**. Consult the [official connection guide](https://help.aliyun.com/zh/ecp/how-to-connect-cloud-phone-via-adb) for that product's current controls.

Make sure the intended instance is running.

## 2. Create a key pair and keep its private key

In **ADB connection → Bind key pair**, open **Key pair management**, choose **Create**, enter a name such as `xopc-phone`, and confirm. Keep the downloaded `adbkey` from your browser's Downloads folder. Standard Cloud Phone also supports creation from its Keys page. See [Alibaba's key management guide](https://help.aliyun.com/zh/ecp/manage-keys).

Upload the **private** `adbkey`, not `adbkey.pub`, a `kp-...` identifier, an AccessKey or a model API key. The filename normally has no extension. If the browser renames repeated downloads, choose the file corresponding to this key pair.

An existing key pair works if you still have its matching private key. If you imported a public key into the console, use the original private key that generated it. A lost private key requires a new key pair and binding; a public key cannot replace it.

xopc accepts an unencrypted RSA 2048 private key. Prefer the `adbkey` downloaded directly from the console. Do not paste it into chat. This adapter does not require replacing `~/.android/adbkey`, installing local Platform Tools, or restarting the host ADB server.

## 3. Bind the key pair to the phone

Creating a key pair alone does not bind it. In the phone's **Bind key pair** panel, select the new key pair and confirm the binding. Standard Cloud Phone also offers binding from its Keys list.

The uploaded private key must match the key pair bound to this phone.

## 4. Create the ADB connection and copy its endpoint

Complete **Create ADB connection**, wait for success, and expand the ADB connection details. If the console shows:

```text
adb connect 203.0.113.10:10001
```

enter only this in xopc:

```text
203.0.113.10:10001
```

Exclude `adb connect`, URL prefixes, console URLs and instance IDs. Keep the displayed port; do not replace a public mapped port with `5555`.

The **Gateway host** must reach this address:

| Deployment | Endpoint to use |
| --- | --- |
| Electron with a local Gateway | Usually the public IP and public port |
| Gateway on a remote server | An endpoint reachable from that server |
| Gateway with routed private network access | The private IP and private port can be used |

For example, if the console lists private `192.168.1.120:5555` and public `203.0.113.10:10001`, a home computer normally needs the public pair. Do not mix the public IP with the private port.

A working cloud browser viewer does not prove ADB connectivity. Complete any product-specific public access or security group setup required by the console, limiting access to the required source addresses. Ports and networking differ between products; use your instance's current details. xopc does not create cloud network rules. See the [official network prerequisites](https://help.aliyun.com/zh/ecp/how-to-connect-cloud-phone-via-adb).

## 5. Test and add it in xopc

1. Open **Settings → Phone Use** and enable it.
2. Choose **Add phone → Alibaba Cloud Phone**.
3. Enter the name and ADB endpoint.
4. Select the downloaded private file under **Private key file (adbkey)**. The browser sends the selected file to the connected Gateway; entering a filesystem path is not a substitute for uploading it.
5. Click **Test connection**. Check the device model, Android version and screenshot. This does not call a phone model or require its API key.
6. Click **Add phone**, optionally selecting **Set as default phone**. A test expires after ten minutes. Editing the endpoint or key requires another test.
7. Check the app list under **Manage**. Initially only `com.android.settings` is allowed. Explicitly allow other package names before previewing or operating those apps.

To run Agent tasks, configure a real phone model in Models and select it in Phone Use. The deterministic mock only supports local emulators. See [phone model configuration](../phone-use.md#configure-a-phone-model).

Start with a small read-only request:

> Use phone_use on the default phone to open Settings and read the Android version. Do not change any settings. Close the phone session when finished.

After installing the pinned video server (`pnpm exec tsx scripts/setup-phone-video.mts`) on the Gateway host, Alibaba Cloud phones reuse the chat panel’s scrcpy live video, continuous touch, takeover and Agent handback. The Gateway uploads the verified server using the saved ADB key and multiplexes video/control over a dedicated connection; the browser receives no private key. Video errors or unsupported WebCodecs fall back to explicitly labelled snapshots. The connection-test preview and Settings preview modal remain snapshots.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No downloaded `adbkey` | Check browser downloads, download location and blocked downloads. Recreate and bind a key pair if the private file is lost. |
| Invalid private key | Use the unencrypted RSA 2048 private key, not a `.pub` file, screenshot or key pair identifier. |
| Authentication or connection failure | Check the running instance, completed ADB connection, and matching key pair binding. |
| Timeout | Check the endpoint and port, cloud access rules, and connectivity from the Gateway host. |
| Successful test but no registered phone | Click Add phone after testing. Retest after expiry or a Gateway restart. |
| Setup screenshot works but regular preview is denied | Regular preview enforces allowed apps. Open an allowed app or explicitly update its package list in Manage. |
| Mock cannot operate the phone | Select a configured real phone model; mock mode only supports local emulators. |
| Endpoint or key changed | Remove the old xopc connection and test/add it again. |

## Credential storage and removal

Test keys stay temporarily in Gateway memory. Adding a phone saves its private key under the Gateway credentials directory's `phone-adb/` subdirectory, normally `~/.xopc/credentials/phone-adb/`. Custom state or credential directories change this location. The directory uses `0700` and files use `0600` where POSIX permissions are supported; device records only store references.

Electron stores credentials on its Gateway computer. A remote Gateway stores them on the server. Uploading the key does not send it to the AI model provider or a cloud account API.

Removing the xopc connection deletes its device record and saved credential. It does not stop or destroy the paid cloud phone, or close its cloud-side ADB endpoint. Manage those separately in the Alibaba console.

Alibaba's generic instructions for replacing `~/.android/adbkey` and restarting ADB describe the traditional command-line client. **Skip those steps for this xopc adapter**: it connects directly without modifying the host's existing ADB service or key.
