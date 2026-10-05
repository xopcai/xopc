package ai.xopc.mobile.gateway

import android.content.Context
import java.util.Base64
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

data class GatewayRoute(val id: String, val kind: String, val url: String)
data class GatewayProfile(
  val gatewayId: String,
  val name: String,
  val gatewayPublicKey: String,
  val deviceId: String,
  val routes: List<GatewayRoute>,
  val activeRouteId: String,
)
data class GatewayProbe(val gatewayId: String, val status: String, val latencyMs: Long,
  val routeUrl: String, val checkedAt: Long)
private data class GatewayCatalog(val profiles: List<GatewayProfile>, val activeGatewayId: String)

/** One verified Gateway session shared by Assistant and Conversations. All calls are blocking: use an IO dispatcher. */
class GatewaySession(
  private val context: Context,
  private val http: GatewayHttp = GatewayTransport(),
  private val identity: DeviceIdentity = DeviceIdentity(),
  private val store: AndroidSecureStore = AndroidSecureStore(context),
) {
  @Volatile private var profile: GatewayProfile? = null
  @Volatile private var accessToken: String? = null
  @Volatile private var accessExpiresAt: Long = 0

  @Synchronized
  fun request(path: String, method: String = "GET", body: String = "",
    headers: Map<String, String> = emptyMap()): String {
    val current = profile ?: throw IllegalStateException("NOT_PAIRED")
    var token = token()
    var last: Exception = IllegalStateException("NO_VERIFIED_ROUTE")
    for (route in current.routes.sortedBy { if (it.id == current.activeRouteId) 0 else 1 }) {
      try {
        verifyRoute(current, route)
        val result = try {
          http.requestWithHeaders(route.url, path, method, body, token, headers)
        } catch (error: GatewayHttpException) {
          if (error.status != 401) throw error
          accessToken = null
          token = token()
          http.requestWithHeaders(route.url, path, method, body, token, headers)
        }
        if (route.id != current.activeRouteId) {
          val updated = current.copy(activeRouteId = route.id)
          val catalog = readCatalog()
          writeCatalog(catalog.copy(profiles = catalog.profiles.map {
            if (it.gatewayId == updated.gatewayId) updated else it }))
          store.write("profile", profileJson(updated).toString())
          profile = updated
        }
        return result
      } catch (error: Exception) {
        last = error
        if (method != "GET" || (error is GatewayHttpException && error.status < 500)) throw error
      }
    }
    throw last
  }

  @Synchronized
  fun requestBytes(path: String): ByteArray {
    val current = profile ?: throw IllegalStateException("NOT_PAIRED")
    var access = token()
    var last: Exception = IllegalStateException("NO_VERIFIED_ROUTE")
    for (route in current.routes.sortedBy { if (it.id == current.activeRouteId) 0 else 1 }) {
      try {
        verifyRoute(current, route)
        return try {
          http.requestBytes(route.url, path, access)
        } catch (error: GatewayHttpException) {
          if (error.status != 401) throw error
          accessToken = null
          access = token()
          http.requestBytes(route.url, path, access)
        }
      } catch (error: Exception) {
        last = error
        if (error is GatewayHttpException && error.status < 500) throw error
      }
    }
    throw last
  }

  @Synchronized
  fun token(): String {
    val current = profile ?: throw IllegalStateException("NOT_PAIRED")
    val now = System.currentTimeMillis()
    accessToken?.let { if (accessExpiresAt > now + 30_000) return it }
    val refreshKey = "refresh.${current.gatewayId}"
    val saved = store.read(refreshKey) ?: throw IllegalStateException("NOT_PAIRED")
    val attemptKey = "refresh-attempt.${current.gatewayId}"
    val attempt = store.read(attemptKey)?.let(::JSONObject) ?: JSONObject()
      .put("refreshToken", saved).put("nextRefreshToken", identity.refreshToken())
      .put("requestId", UUID.randomUUID().toString())
      .also { store.write(attemptKey, it.toString()) }
    require(attempt.getString("refreshToken") == saved) { "REFRESH_ATTEMPT_MISMATCH" }
    val next = attempt.getString("nextRefreshToken")
    val requestId = attempt.getString("requestId")
    val credentialId = saved.removePrefix("xopc_rt_").substringBefore('_')
    UUID.fromString(credentialId)
    var last: Exception = IllegalStateException("NO_VERIFIED_ROUTE")
    for (route in current.routes.sortedBy { if (it.id == current.activeRouteId) 0 else 1 }) {
      try {
        verifyRoute(current, route)
        val timestamp = System.currentTimeMillis()
        val nonce = identity.nonce()
        val body = JSONObject().put("refreshToken", saved).put("nextRefreshToken", next)
          .put("requestId", requestId).put("timestamp", timestamp).put("nonce", nonce)
          .put("signature", identity.sign(DeviceProof.refresh(credentialId, timestamp, nonce, requestId, next)))
        val proof = verifiedJson(PairingProtocol.decodeBase64Url(current.gatewayPublicKey),
          http.request(route.url, "/api/device-auth/refresh", "POST", body.toString()))
        val expiresAt = proof.getLong("expiresAt")
        val tokens = proof.getJSONObject("tokens")
        val checkedAt = System.currentTimeMillis()
        require(proof.getString("purpose") == "device-refresh-v3" && proof.getString("gatewayId") == current.gatewayId &&
          proof.getString("nonce") == nonce && proof.getString("requestId") == requestId &&
          expiresAt > checkedAt && expiresAt <= checkedAt + 60_000 &&
          tokens.getString("refreshToken") == next && tokens.getLong("refreshTokenExpiresAt") > checkedAt &&
          tokens.getLong("accessTokenExpiresAt") > checkedAt) { "GATEWAY_IDENTITY_MISMATCH" }
        val access = tokens.getString("accessToken")
        require(access.isNotBlank()) { "GATEWAY_IDENTITY_MISMATCH" }
        store.write(refreshKey, next)
        store.remove(attemptKey)
        accessToken = access
        accessExpiresAt = tokens.getLong("accessTokenExpiresAt")
        return access
      } catch (error: Exception) {
        if (error is GatewayHttpException && error.status in setOf(401, 403)) throw IllegalStateException("DEVICE_AUTH_DENIED", error)
        last = error
      }
    }
    throw IllegalStateException("NO_VERIFIED_ROUTE", last)
  }

  @Synchronized
  fun restore(onConfirmationCode: (String) -> Unit = {}): GatewayProfile? {
    val catalog = readCatalog()
    val restored = catalog.profiles.firstOrNull { it.gatewayId == catalog.activeGatewayId }
    if (restored != null) {
      val pin = store.read("identity.${restored.gatewayId}")
      require(pin == restored.gatewayPublicKey) { "GATEWAY_IDENTITY_MISMATCH" }
      profile = restored
    }
    val pending = store.read("pairing")
    return if (pending != null) pair(JSONObject(pending).getString("link"), onConfirmationCode) else profile
  }

  fun currentProfile(): GatewayProfile? = profile

  @Synchronized
  fun savedProfiles(): List<GatewayProfile> = readCatalog().profiles

  /** Checks the candidate without publishing it as the active Gateway. */
  @Synchronized
  fun probeProfile(gatewayId: String): GatewayProbe {
    val target = readCatalog().profiles.firstOrNull { it.gatewayId == gatewayId }
      ?: throw IllegalStateException("NOT_PAIRED")
    require(store.read("identity.$gatewayId") == target.gatewayPublicKey) { "GATEWAY_IDENTITY_MISMATCH" }
    val candidate = GatewaySession(context, http, identity, store).also { it.profile = target }
    return candidate.statusProbe()
  }

  @Synchronized
  fun activate(gatewayId: String): GatewayProfile {
    val catalog = readCatalog()
    val target = catalog.profiles.firstOrNull { it.gatewayId == gatewayId }
      ?: throw IllegalStateException("NOT_PAIRED")
    if (profile?.gatewayId == gatewayId) return profile!!
    require(store.read("identity.$gatewayId") == target.gatewayPublicKey) { "GATEWAY_IDENTITY_MISMATCH" }
    val candidate = GatewaySession(context, http, identity, store).also { it.profile = target }
    candidate.statusProbe()
    val verified = candidate.profile ?: throw IllegalStateException("NOT_PAIRED")
    writeCatalog(catalog.copy(profiles = catalog.profiles.map {
      if (it.gatewayId == gatewayId) verified else it }, activeGatewayId = gatewayId))
    store.write("profile", profileJson(verified).toString())
    profile = verified
    accessToken = candidate.accessToken
    accessExpiresAt = candidate.accessExpiresAt
    return verified
  }

  @Synchronized
  fun renameProfile(gatewayId: String, name: String): GatewayProfile {
    val normalized = name.trim().take(80)
    require(normalized.isNotEmpty()) { "INVALID_GATEWAY_NAME" }
    val catalog = readCatalog()
    require(catalog.profiles.any { it.gatewayId == gatewayId }) { "NOT_PAIRED" }
    val updated = catalog.profiles.map { if (it.gatewayId == gatewayId) it.copy(name = normalized) else it }
    writeCatalog(catalog.copy(profiles = updated))
    if (profile?.gatewayId == gatewayId) {
      profile = updated.first { it.gatewayId == gatewayId }
      store.write("profile", profileJson(profile!!).toString())
    }
    return updated.first { it.gatewayId == gatewayId }
  }

  @Synchronized
  fun removeProfile(gatewayId: String): GatewayProfile? {
    val catalog = readCatalog()
    require(catalog.profiles.any { it.gatewayId == gatewayId }) { "NOT_PAIRED" }
    val remaining = catalog.profiles.filterNot { it.gatewayId == gatewayId }
    val nextId = if (catalog.activeGatewayId == gatewayId) remaining.firstOrNull()?.gatewayId.orEmpty()
      else catalog.activeGatewayId
    writeCatalog(GatewayCatalog(remaining, nextId))
    if (profile?.gatewayId == gatewayId) {
      profile = remaining.firstOrNull { it.gatewayId == nextId }
      accessToken = null
      accessExpiresAt = 0
      if (profile == null) store.remove("profile") else store.write("profile", profileJson(profile!!).toString())
    }
    store.remove("refresh.$gatewayId")
    store.remove("refresh-attempt.$gatewayId")
    store.remove("main-chat.$gatewayId")
    return profile
  }

  private fun statusProbe(): GatewayProbe {
    val current = profile ?: throw IllegalStateException("NOT_PAIRED")
    val started = System.currentTimeMillis()
    val token = token()
    var last: Exception = IllegalStateException("NO_VERIFIED_ROUTE")
    for (route in current.routes.sortedBy { if (it.id == current.activeRouteId) 0 else 1 }) {
      try {
        verifyRoute(current, route)
        val status = JSONObject(http.request(route.url, "/api/status", "GET", "", token)).getString("status")
        require(status.isNotBlank()) { "INVALID_GATEWAY_STATUS" }
        profile = current.copy(activeRouteId = route.id)
        return GatewayProbe(current.gatewayId, status, System.currentTimeMillis() - started,
          route.url, System.currentTimeMillis())
      } catch (error: Exception) { last = error }
    }
    throw last
  }

  @Synchronized
  fun activeVerifiedOrigin(): String {
    val current = profile ?: throw IllegalStateException("NOT_PAIRED")
    val route = current.routes.firstOrNull { it.id == current.activeRouteId } ?: throw IllegalStateException("NO_VERIFIED_ROUTE")
    verifyRoute(current, route)
    return route.url
  }

  @Synchronized
  fun mainConversationId(): String? {
    val gatewayId = profile?.gatewayId ?: return null
    return store.read("main-chat.$gatewayId")?.takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) }
  }

  @Synchronized
  fun saveMainConversationId(conversationId: String) {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    val gatewayId = profile?.gatewayId ?: throw IllegalStateException("NOT_PAIRED")
    store.write("main-chat.$gatewayId", conversationId)
  }

  @Synchronized
  fun clearMainConversationId(conversationId: String) {
    val gatewayId = profile?.gatewayId ?: return
    val key = "main-chat.$gatewayId"
    if (store.read(key) == conversationId) store.remove(key)
  }

  @Synchronized
  fun pair(link: String, onConfirmationCode: (String) -> Unit = {}): GatewayProfile {
    val saved = store.read("pairing")?.let(::JSONObject)
    val invitation = PairingProtocol.readInvitation(link, if (saved == null) System.currentTimeMillis() else 0)
    val gatewayId = invitation.gatewayId.toString()
    val pin = store.read("identity.$gatewayId")
    require(pin == null || pin == encode(invitation.gatewayPublicKey)) { "GATEWAY_IDENTITY_MISMATCH" }
    val current = readCatalog().profiles.firstOrNull { it.gatewayId == gatewayId }
    require(current == null || current.gatewayPublicKey == encode(invitation.gatewayPublicKey)) {
      "GATEWAY_IDENTITY_MISMATCH"
    }
    val journal = if (saved != null) {
      require(saved.getString("link") == link.trim()) { "PAIRING_ALREADY_PENDING" }
      saved
    } else {
      val origin = probe(invitation)
      JSONObject()
        .put("link", link.trim()).put("origin", origin)
        .put("requestId", UUID.randomUUID().toString())
        .put("idempotencyKey", UUID.randomUUID().toString())
        .put("initialRefreshToken", identity.refreshToken())
        .also { store.write("pairing", it.toString()) }
    }
    var response = pairingRequest(invitation, journal, "request")
    var request = response.getJSONObject("request")
    while (request.getString("status") == "pending") {
      onConfirmationCode(request.getString("confirmationCode"))
      if (System.currentTimeMillis() >= request.getLong("expiresAt")) throw IllegalStateException("PAIRING_EXPIRED")
      Thread.sleep(1_500)
      response = pairingRequest(invitation, journal, "status")
      request = response.getJSONObject("request")
    }
    require(request.getString("status") in setOf("approved", "completed")) { "PAIRING_${request.getString("status").uppercase()}" }
    response = pairingRequest(invitation, journal, "complete")
    request = response.getJSONObject("request")
    require(request.getString("status") == "completed") { "INVALID_PAIRING_RESPONSE" }
    val routes = parseRoutes(response.getJSONArray("routes"))
    val origin = journal.getString("origin")
    val result = GatewayProfile(
      gatewayId, response.getJSONObject("gateway").getString("name"), encode(invitation.gatewayPublicKey),
      request.getString("deviceId"), routes, routes.firstOrNull { it.url == origin }?.id ?: routes.first().id,
    )
    store.write("identity.$gatewayId", result.gatewayPublicKey)
    store.write("refresh.$gatewayId", journal.getString("initialRefreshToken"))
    val catalog = readCatalog()
    writeCatalog(GatewayCatalog(listOf(result) + catalog.profiles.filterNot { it.gatewayId == gatewayId }, gatewayId))
    store.write("profile", profileJson(result).toString())
    store.remove("pairing")
    profile = result
    accessToken = null
    accessExpiresAt = 0
    return result
  }

  private fun probe(invitation: PairingInvitation): String {
    var last: Exception? = null
    for (origin in invitation.origins) {
      try {
        val raw = http.request(origin, "/api/device-pairing/probe", "POST", JSONObject().put("pairingId", invitation.pairingId.toString()).toString())
        val proof = verifiedJson(invitation.gatewayPublicKey, raw)
        require(proof.getString("gatewayId") == invitation.gatewayId.toString() &&
          proof.getString("pairingId") == invitation.pairingId.toString() &&
          kotlin.math.abs(System.currentTimeMillis() - proof.getLong("issuedAt")) <= 300_000) { "GATEWAY_IDENTITY_MISMATCH" }
        return origin
      } catch (error: Exception) {
        if (error is GatewayHttpException && error.status < 500 && error.status !in setOf(404, 408, 425, 429)) throw error
        last = error
      }
    }
    throw IllegalStateException("NO_VERIFIED_ROUTE", last)
  }

  private fun pairingRequest(invitation: PairingInvitation, journal: JSONObject, action: String): JSONObject {
    val requestId = journal.getString("requestId")
    val body = PairingProofBody(
      gatewayId = invitation.gatewayId.toString(), requestId = requestId, pairingToken = invitation.pairingToken,
      timestamp = System.currentTimeMillis(), nonce = identity.nonce(),
      device = if (action == "request") identity.publicKey() else null,
      idempotencyKey = if (action == "complete") journal.getString("idempotencyKey") else null,
      initialRefreshToken = if (action == "complete") journal.getString("initialRefreshToken") else null,
    )
    val json = JSONObject()
      .put("gatewayId", body.gatewayId).put("requestId", body.requestId).put("pairingToken", body.pairingToken)
      .put("timestamp", body.timestamp).put("nonce", body.nonce)
    body.device?.let { key -> json.put("device", JSONObject().put("displayName", body.displayName).put("platform", "android")
      .put("publicKeyJwk", JSONObject().put("kty", key.kty).put("crv", key.crv).put("x", key.x).put("y", key.y))) }
    body.idempotencyKey?.let { json.put("idempotencyKey", it) }
    body.initialRefreshToken?.let { json.put("initialRefreshToken", it) }
    json.put("signature", identity.sign(DeviceProof.pairing(action, body)))
    val path = if (action == "request") "/api/device-pairing/requests" else "/api/device-pairing/requests/$requestId/$action"
    val result = verifiedJson(invitation.gatewayPublicKey, http.request(journal.getString("origin"), path, "POST", json.toString()))
    require(result.getJSONObject("gateway").getString("id") == body.gatewayId && result.getString("nonce") == body.nonce &&
      result.getJSONObject("request").getString("requestId") == requestId) { "GATEWAY_IDENTITY_MISMATCH" }
    return result
  }

  private fun verifiedJson(publicKey: ByteArray, raw: String): JSONObject {
    val envelope = JSONObject(raw)
    return JSONObject(PairingProtocol.verifyEnvelope(publicKey,
      SignedEnvelope(envelope.getString("signedPayload"), envelope.getString("signature"))).toString(Charsets.UTF_8))
  }

  private fun verifyRoute(current: GatewayProfile, route: GatewayRoute) {
    val nonce = identity.nonce()
    val body = JSONObject().put("nonce", nonce).toString()
    val proof = verifiedJson(PairingProtocol.decodeBase64Url(current.gatewayPublicKey),
      http.request(route.url, "/api/gateway-identity/challenge", "POST", body))
    val now = System.currentTimeMillis()
    val expiry = proof.getLong("expiresAt")
    require(proof.getString("purpose") == "gateway-route-v1" && proof.getString("gatewayId") == current.gatewayId &&
      proof.getString("nonce") == nonce && expiry > now && expiry <= now + 60_000) { "GATEWAY_IDENTITY_MISMATCH" }
  }

  private fun parseRoutes(value: JSONArray): List<GatewayRoute> {
    require(value.length() in 1..8) { "INVALID_ROUTES" }
    val routes = (0 until value.length()).map { index ->
      val route = value.getJSONObject(index)
      val id = route.getString("id")
      require(id.isNotBlank() && id.length <= 80) { "INVALID_ROUTES" }
      val kind = route.getString("kind")
      require(kind in setOf("xopc-secure-link", "tailscale", "custom-https")) { "INVALID_ROUTES" }
      GatewayRoute(id, kind, PairingProtocol.secureOrigin(route.getString("url")))
    }
    require(routes.map { it.id }.toSet().size == routes.size) { "INVALID_ROUTES" }
    return routes
  }

  private fun profileJson(value: GatewayProfile): JSONObject = JSONObject()
    .put("gatewayId", value.gatewayId).put("name", value.name).put("gatewayPublicKey", value.gatewayPublicKey)
    .put("deviceId", value.deviceId).put("activeRouteId", value.activeRouteId)
    .put("routes", JSONArray().also { array -> value.routes.forEach { route ->
      array.put(JSONObject().put("id", route.id).put("kind", route.kind).put("url", route.url))
    } })

  private fun readCatalog(): GatewayCatalog {
    val raw = store.read("gateway-catalog") ?: return store.read("profile")?.let { legacy ->
      val parsed = parseProfile(JSONObject(legacy))
      GatewayCatalog(listOf(parsed), parsed.gatewayId)
    } ?: GatewayCatalog(emptyList(), "")
    val json = JSONObject(raw)
    val items = json.getJSONArray("profiles")
    require(items.length() <= 20) { "INVALID_PROFILE" }
    val profiles = (0 until items.length()).map { parseProfile(items.getJSONObject(it)) }
    require(profiles.map { it.gatewayId }.distinct().size == profiles.size) { "INVALID_PROFILE" }
    val activeId = json.getString("activeGatewayId")
    require(activeId.isEmpty() || profiles.any { it.gatewayId == activeId }) { "INVALID_PROFILE" }
    return GatewayCatalog(profiles, activeId)
  }

  private fun writeCatalog(catalog: GatewayCatalog) {
    store.write("gateway-catalog", JSONObject().put("activeGatewayId", catalog.activeGatewayId)
      .put("profiles", JSONArray().also { rows -> catalog.profiles.forEach { rows.put(profileJson(it)) } }).toString())
  }

  private fun parseProfile(value: JSONObject): GatewayProfile {
    val routes = parseRoutes(value.getJSONArray("routes"))
    val gatewayId = value.getString("gatewayId")
    UUID.fromString(gatewayId)
    val key = value.getString("gatewayPublicKey")
    require(PairingProtocol.decodeBase64Url(key).size == 32) { "INVALID_GATEWAY_KEY" }
    val activeRouteId = value.getString("activeRouteId")
    require(routes.any { it.id == activeRouteId }) { "INVALID_ROUTES" }
    return GatewayProfile(gatewayId, value.getString("name"), key, value.getString("deviceId"), routes, activeRouteId)
  }

  private fun encode(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
