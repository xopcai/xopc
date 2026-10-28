# Alibaba Cloud phone

First ask whether the user already has an intended cloud phone when inspection cannot tell.
Reuse it if healthy. For purchase, send the official guide
https://help.aliyun.com/zh/ecp/quickly-experience-and-create-cloud-phone-jvs-mobile and explain
that the user must review region, instance, network reachability, current price and automatic
renewal in the official console. Do not quote a fixed price or execute checkout/payment.
Before purchase confirm the product provides an ADB endpoint reachable from the Gateway and
supports its matching private key. Products with private-network-only ADB need actual routed
private access; a public web viewer is not evidence of ADB reachability.

Current reference: https://help.aliyun.com/zh/ecp/how-to-connect-cloud-phone-via-adb and
https://help.aliyun.com/zh/ecp/manage-keys (reviewed 2026-10-24). UI labels can change. Guide:
create/import an ADB key pair, retain the downloaded private adbkey, bind that pair to the
running phone, create/enable its ADB connection, and use the shown address and port together.
Never replace the public mapped port with 5555, mix public/private addresses, expose an
unrestricted network rule or claim the key pair is bound merely because it was created.

Use the host-returned interactionPath for the secure cloud connection modal. The owner enters the endpoint and
uploads the matching unencrypted RSA 2048 private file in the secure form. No Aliyun AccessKey,
account password, model API key or private-key text is needed in chat. Connection testing
shows device information/screenshot before Add phone; editing the endpoint/key requires a new
test. Keys are sent only to the Gateway and saved as restricted credential files, not to the
phone model; do not describe this as OS-keystore encryption. Never replace ~/.android/adbkey
or restart the host ADB service for this direct adapter. Local ADB installation is unnecessary.

Saving rechecks the original setup and returns to its original conversation; do not ask for
an additional continue message. Then configure the Phone model separately, review app access, select this registered device
and start acceptance in the same conversation. Removing the xopc registration does not delete
the paid instance or stop cloud billing. The user manages those in Alibaba's console.
