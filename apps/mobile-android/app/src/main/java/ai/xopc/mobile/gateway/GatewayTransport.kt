package ai.xopc.mobile.gateway

import java.io.InputStream
import java.net.URL
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject
import java.util.UUID

class GatewayHttpException(val status: Int, val code: String? = null, val detail: String? = null) :
  Exception("Gateway HTTP $status${code?.let { ":$it" } ?: ""}${detail?.let { ": $it" } ?: ""}")

interface GatewayHttp {
  fun request(origin: String, path: String, method: String = "GET", body: String = "", bearer: String = ""): String
  fun requestWithHeaders(origin: String, path: String, method: String, body: String, bearer: String,
    headers: Map<String, String>): String = request(origin, path, method, body, bearer)
  fun requestBytes(origin: String, path: String, bearer: String = ""): ByteArray =
    request(origin, path, "GET", "", bearer).toByteArray(Charsets.UTF_8)
  fun postBytes(origin: String, path: String, body: String, bearer: String): ByteArray =
    throw UnsupportedOperationException("BINARY_POST_UNAVAILABLE")
  fun uploadMultipart(origin: String, path: String, bearer: String, name: String,
    mimeType: String, bytes: ByteArray, mutationId: String, durationSeconds: Int? = null): String =
    throw UnsupportedOperationException("MULTIPART_UNAVAILABLE")
  fun transcribeAudio(origin: String, bearer: String, bytes: ByteArray, language: String): String =
    throw UnsupportedOperationException("TRANSCRIPTION_UNAVAILABLE")
}

/** HTTPS-only transport for Gateway API calls; the caller must verify signed identity proofs. */
class GatewayTransport : GatewayHttp {
  override fun transcribeAudio(origin: String, bearer: String, bytes: ByteArray,
    language: String): String {
    require(bytes.size in 1..(4 * 1024 * 1024) && language in setOf("", "zh", "en")) {
      "INVALID_RECORDING_SIZE"
    }
    val boundary = "xopc-${UUID.randomUUID()}"
    val prefix = ("--$boundary\r\nContent-Disposition: form-data; name=\"audio\"; " +
      "filename=\"voice.m4a\"\r\nContent-Type: audio/m4a\r\n\r\n").toByteArray(Charsets.UTF_8)
    val suffix = ("\r\n" + (if (language.isNotEmpty())
      "--$boundary\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n$language\r\n"
      else "") + "--$boundary--\r\n").toByteArray(Charsets.UTF_8)
    val connection = URL(PairingProtocol.secureOrigin(origin) + "/api/voice/transcriptions")
      .openConnection() as HttpsURLConnection
    try {
      connection.requestMethod = "POST"
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 8_000
      connection.readTimeout = 60_000
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(prefix.size + bytes.size + suffix.size)
      connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      connection.setRequestProperty("Authorization", "Bearer $bearer")
      connection.outputStream.use { it.write(prefix); it.write(bytes); it.write(suffix) }
      val status = connection.responseCode
      if (status !in 200..299) throw GatewayHttpException(status)
      return connection.inputStream.use { readBounded(it).toString(Charsets.UTF_8) }
    } finally { connection.disconnect() }
  }
  override fun request(origin: String, path: String, method: String, body: String, bearer: String): String =
    requestWithHeaders(origin, path, method, body, bearer, emptyMap())

  override fun requestWithHeaders(origin: String, path: String, method: String, body: String,
    bearer: String, headers: Map<String, String>): String {
    val url = URL(PairingProtocol.secureOrigin(origin) + apiPath(path))
    require(method in setOf("GET", "POST", "PATCH", "PUT", "DELETE")) { "INVALID_METHOD" }
    require(method != "GET" || body.isEmpty()) { "INVALID_BODY" }
    require(body.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "REQUEST_TOO_LARGE" }
    val connection = url.openConnection() as HttpsURLConnection
    try {
      connection.requestMethod = method
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 8_000
      connection.readTimeout = 30_000
      connection.setRequestProperty("Accept", "application/json")
      if (bearer.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer $bearer")
      headers.forEach { (name, value) ->
        require(when (name) {
          "X-Xopc-Expected-Session-Key", "Idempotency-Key" ->
            value.matches(Regex("[0-9a-fA-F-]{36}"))
          else -> false
        }) { "INVALID_REQUEST_HEADER" }
        connection.setRequestProperty(name, value)
      }
      if (body.isNotEmpty() || method == "POST" || method == "PATCH" || method == "PUT") {
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val status = connection.responseCode
      if (status !in 200..299) {
        val error = connection.errorStream?.use { input ->
          runCatching { JSONObject(readBounded(input).toString(Charsets.UTF_8)).optJSONObject("error") }.getOrNull()
        }
        val code = error?.optString("code")?.takeIf { it.matches(Regex("[A-Z_]{1,80}")) }
        val detail = error?.optString("message")?.takeIf { it.isNotBlank() }?.take(240)
        throw GatewayHttpException(status, code, detail)
      }
      return connection.inputStream.use { input -> readBounded(input).toString(Charsets.UTF_8) }
    } finally {
      connection.disconnect()
    }
  }

  override fun requestBytes(origin: String, path: String, bearer: String): ByteArray {
    val url = URL(PairingProtocol.secureOrigin(origin) + apiPath(path))
    val connection = url.openConnection() as HttpsURLConnection
    try {
      connection.requestMethod = "GET"
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 8_000
      connection.readTimeout = 30_000
      if (bearer.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer $bearer")
      val status = connection.responseCode
      if (status !in 200..299) throw GatewayHttpException(status)
      return connection.inputStream.use(::readMediaBounded)
    } finally {
      connection.disconnect()
    }
  }

  override fun postBytes(origin: String, path: String, body: String, bearer: String): ByteArray {
    require(body.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "REQUEST_TOO_LARGE" }
    val url = URL(PairingProtocol.secureOrigin(origin) + apiPath(path))
    val connection = url.openConnection() as HttpsURLConnection
    try {
      connection.requestMethod = "POST"
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 8_000
      connection.readTimeout = 60_000
      connection.setRequestProperty("Accept", "audio/*")
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.setRequestProperty("Authorization", "Bearer $bearer")
      connection.doOutput = true
      connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      if (status !in 200..299) throw GatewayHttpException(status)
      return connection.inputStream.use(::readMediaBounded)
    } finally { connection.disconnect() }
  }

  override fun uploadMultipart(origin: String, path: String, bearer: String, name: String,
    mimeType: String, bytes: ByteArray, mutationId: String, durationSeconds: Int?): String {
    require(bytes.size in 1..(8 * 1024 * 1024) && name.length in 1..255 &&
      name.none { it.code < 32 || it == '"' || it == '\\' } &&
      mimeType.matches(Regex("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")) &&
      mutationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_MEDIA_UPLOAD" }
    val boundary = "xopc-${UUID.randomUUID()}"
    val prefix = ("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; " +
      "filename=\"$name\"\r\nContent-Type: $mimeType\r\n\r\n").toByteArray(Charsets.UTF_8)
    val suffix = ("\r\n" + (durationSeconds?.let {
      require(it in 1..600) { "INVALID_MEDIA_DURATION" }
      "--$boundary\r\nContent-Disposition: form-data; name=\"duration\"\r\n\r\n$it\r\n"
    } ?: "") + "--$boundary--\r\n").toByteArray(Charsets.UTF_8)
    val connection = URL(PairingProtocol.secureOrigin(origin) + apiPath(path))
      .openConnection() as HttpsURLConnection
    try {
      connection.requestMethod = "POST"
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 8_000
      connection.readTimeout = 60_000
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(prefix.size + bytes.size + suffix.size)
      connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      connection.setRequestProperty("Authorization", "Bearer $bearer")
      connection.setRequestProperty("Idempotency-Key", mutationId)
      connection.outputStream.use { output ->
        output.write(prefix); output.write(bytes); output.write(suffix)
      }
      if (connection.responseCode != 201) throw GatewayHttpException(connection.responseCode)
      return connection.inputStream.use { readBounded(it).toString(Charsets.UTF_8) }
    } finally { connection.disconnect() }
  }

  companion object {
    private const val MAX_BYTES = 5 * 1024 * 1024
    private val pathPattern = Regex("^/api/[A-Za-z0-9_./%-]+(?:\\?[A-Za-z0-9_&=%+.-]*)?$")

    fun apiPath(path: String): String {
      require(pathPattern.matches(path)) { "INVALID_API_PATH" }
      val uri = URI(path)
      require(!uri.isAbsolute && uri.rawFragment == null && uri.rawAuthority == null &&
        uri.path.split('/').none { it == "." || it == ".." || '\\' in it }) { "INVALID_API_PATH" }
      return path
    }

    private fun readBounded(input: InputStream): ByteArray {
      val output = java.io.ByteArrayOutputStream()
      val chunk = ByteArray(8192)
      while (true) {
        val count = input.read(chunk)
        if (count < 0) break
        require(output.size() + count <= MAX_BYTES) { "RESPONSE_TOO_LARGE" }
        output.write(chunk, 0, count)
      }
      return output.toByteArray()
    }

    private fun readMediaBounded(input: InputStream): ByteArray {
      val output = java.io.ByteArrayOutputStream()
      val chunk = ByteArray(8192)
      while (true) {
        val count = input.read(chunk)
        if (count < 0) break
        require(output.size() + count <= 16 * 1024 * 1024) { "RESPONSE_TOO_LARGE" }
        output.write(chunk, 0, count)
      }
      return output.toByteArray()
    }
  }
}
