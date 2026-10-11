package ai.xopc.mobile.gateway

import java.security.MessageDigest
import java.net.URI
import javax.net.ssl.HttpsURLConnection

/** Shared byte-level proof format. Keys remain owned by DeviceIdentity. */
object DeviceRequestProof {
  private data class Binding(val gatewayId: String, val identity: DeviceIdentity, val offsetMs: Long)
  private val tokens = LinkedHashMap<String, Binding>()
  private val origins = LinkedHashMap<String, Binding>()

  @Synchronized
  fun register(token: String, gatewayId: String, routes: List<GatewayRoute>, identity: DeviceIdentity, offsetMs: Long = 0) {
    val binding = Binding(gatewayId, identity, offsetMs)
    tokens[token] = binding
    routes.forEach { origins[it.url.trimEnd('/')] = binding }
    while (tokens.size > 128) tokens.remove(tokens.keys.first())
  }

  fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
    .joinToString("") { "%02x".format(it.toInt() and 255) }

  fun message(gatewayId: String, credential: String, method: String, target: String, bodyHash: String,
    headers: List<String>, timestamp: Long, nonce: String): String =
    (listOf("xopc-request-v1", gatewayId, digest(credential.toByteArray(Charsets.UTF_8)), method, target, bodyHash)
      + headers + listOf(timestamp.toString(), nonce)).joinToString("\n")

  private fun proof(binding: Binding, credential: String, method: String, target: String,
    body: List<ByteArray>, headers: List<String>): String {
    val hash = MessageDigest.getInstance("SHA-256")
    body.forEach(hash::update)
    val digest = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    val timestamp = System.currentTimeMillis() + binding.offsetMs
    val nonce = binding.identity.nonce()
    val message = message(binding.gatewayId, credential, method, target, digest, headers, timestamp, nonce)
    return "$timestamp.$nonce.$digest.${binding.identity.sign(message)}"
  }

  @Synchronized
  fun apply(connection: HttpsURLConnection, bearer: String, body: List<ByteArray> = emptyList()) {
    if (!bearer.startsWith("xopc_at_")) return
    val binding = tokens[bearer] ?: error("DEVICE_PROOF_CONTEXT_MISSING")
    val uri = connection.url.toURI()
    require(origins["${uri.scheme}://${uri.rawAuthority}"]?.gatewayId == binding.gatewayId) { "GATEWAY_IDENTITY_MISMATCH" }
    val target = uri.rawPath + (uri.rawQuery?.let { "?$it" } ?: "")
    val headers = listOf("Content-Type", "Idempotency-Key", "X-Xopc-Expected-Session-Key", "x-endpoint-id", "x-endpoint-upload-token")
      .map { connection.getRequestProperty(it) ?: "" }
    connection.setRequestProperty("X-Xopc-Proof", proof(binding, bearer, connection.requestMethod, target, body, headers))
  }

  @Synchronized
  fun upload(bearer: String, method: String, target: String, bytes: ByteArray, headers: List<String>): String {
    val binding = tokens[bearer] ?: error("DEVICE_PROOF_CONTEXT_MISSING")
    return proof(binding, bearer, method, target, listOf(bytes), headers)
  }

  @Synchronized
  fun connection(origin: String, path: String, ticket: String): String {
    val binding = origins[origin.trimEnd('/')] ?: error("DEVICE_PROOF_CONTEXT_MISSING")
    return proof(binding, ticket, "CONNECT", path, emptyList(), List(5) { "" })
  }
}
