package ai.xopc.mobile.gateway

data class PairingProofBody(
  val gatewayId: String,
  val requestId: String,
  val pairingToken: String,
  val timestamp: Long,
  val nonce: String,
  val device: DevicePublicKey? = null,
  val displayName: String = "Android",
  val idempotencyKey: String? = null,
  val initialRefreshToken: String? = null,
)

/** Domain-separated strings must match the Gateway's recursively sorted JSON exactly. */
object DeviceProof {
  fun pairing(action: String, body: PairingProofBody): String {
    require(action in setOf("request", "status", "complete", "cancel"))
    val fields = mutableListOf<String>()
    body.device?.let { key ->
      fields += "\"device\":{\"displayName\":${quote(body.displayName)},\"platform\":\"android\",\"publicKeyJwk\":{\"crv\":${quote(key.crv)},\"kty\":${quote(key.kty)},\"x\":${quote(key.x)},\"y\":${quote(key.y)}}}"
    }
    fields += "\"gatewayId\":${quote(body.gatewayId)}"
    body.idempotencyKey?.let { fields += "\"idempotencyKey\":${quote(it)}" }
    body.initialRefreshToken?.let { fields += "\"initialRefreshToken\":${quote(it)}" }
    fields += "\"nonce\":${quote(body.nonce)}"
    fields += "\"pairingToken\":${quote(body.pairingToken)}"
    fields += "\"requestId\":${quote(body.requestId)}"
    fields += "\"timestamp\":${body.timestamp}"
    return "xopc-device-pairing-v3\nPOST\n$action\n{${fields.joinToString(",")}}"
  }

  fun refresh(credentialId: String, timestamp: Long, nonce: String, requestId: String, nextRefreshToken: String): String =
    "xopc-device-refresh-v2\n$credentialId\n$timestamp\n$nonce\n$requestId\n$nextRefreshToken"

  private fun quote(value: String): String = buildString {
    append('"')
    value.forEach { character ->
      when (character) {
        '"' -> append("\\\"")
        '\\' -> append("\\\\")
        '\b' -> append("\\b")
        '\u000c' -> append("\\f")
        '\n' -> append("\\n")
        '\r' -> append("\\r")
        '\t' -> append("\\t")
        else -> if (character.code < 0x20) append("\\u%04x".format(character.code)) else append(character)
      }
    }
    append('"')
  }
}
