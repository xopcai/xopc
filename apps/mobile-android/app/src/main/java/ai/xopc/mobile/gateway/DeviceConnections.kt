package ai.xopc.mobile.gateway

import org.json.JSONObject

data class DeviceConnectionFolder(val id: String, val kind: String, val label: String)
data class DeviceCapability(val name: String, val title: String, val titleZh: String, val allowed: Boolean)
data class ConnectedDevice(val id: String, val name: String, val kind: String, val platform: String,
  val endpointId: String?, val availability: String, val tools: Set<String>, val folders: List<DeviceConnectionFolder>,
  val capabilities: List<DeviceCapability>? = null)
data class DeviceConnections(val currentDeviceId: String?, val devices: List<ConnectedDevice>)

internal fun GatewaySession.loadDeviceConnections(): DeviceConnections {
  val payload = JSONObject(request("/api/endpoint-tools/device-connections")).getJSONObject("payload")
  val devices = payload.getJSONArray("devices")
  return DeviceConnections(payload.optString("currentDeviceId").takeIf(String::isNotBlank),
    List(devices.length()) { index ->
      val row = devices.getJSONObject(index)
      val tools = row.getJSONArray("tools")
      val folders = row.getJSONArray("folders")
      ConnectedDevice(row.getString("id"), row.getString("name"), row.getString("kind"), row.getString("platform"),
        row.optString("endpointId").takeIf(String::isNotBlank), row.getString("availability"),
        List(tools.length(), tools::getString).toSet(), List(folders.length()) { folderIndex ->
          val folder = folders.getJSONObject(folderIndex)
          DeviceConnectionFolder(folder.getString("id"), folder.getString("kind"), folder.getString("label"))
        }, row.optJSONArray("capabilities")?.let { list ->
          List(list.length()) { capabilityIndex ->
            val capability = list.getJSONObject(capabilityIndex)
            DeviceCapability(capability.getString("name"), capability.getString("title"), capability.getString("titleZh"),
              capability.getBoolean("allowed"))
          }
        })
    })
}

internal fun GatewaySession.setDeviceCapability(toolName: String, allowed: Boolean, deviceId: String) = synchronized(this) {
  check(currentProfile()?.deviceId == deviceId) { "GATEWAY_CHANGED" }
  val body = JSONObject().put("toolName", toolName).put("allowed", allowed)
  check(JSONObject(request("/api/endpoint-tools/device-connections", "PATCH", body.toString()))
    .getBoolean("ok"))
}

data class DesktopChatTarget(val name: String, val state: String, val reselectEndpointId: String?)

internal fun GatewaySession.loadDesktopChatTarget(conversationId: String): DesktopChatTarget? {
  val result = JSONObject(request("/api/endpoint-tools/targets/$conversationId")).getJSONObject("payload")
  val name = result.optString("deviceName").takeIf(String::isNotBlank) ?: return null
  return DesktopChatTarget(name, result.getString("deviceState"), result.optString("reselectEndpointId").takeIf(String::isNotBlank))
}
