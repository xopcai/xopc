package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.caverock.androidsvg.SVG
import java.util.Base64
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

private const val LOGO_LIMIT = 512 * 1024L
private val logoCache = LruCache<String, Bitmap>(96)
private val logoHttp = OkHttpClient.Builder().followRedirects(false).callTimeout(8, TimeUnit.SECONDS).build()
private val logoPath = Regex("^/(connector-icons|channel-icons)/[a-z0-9_%.-]+(/[a-z0-9_%.-]+)?$", RegexOption.IGNORE_CASE)
private val encodedSeparator = Regex("%(2e|2f|5c)", RegexOption.IGNORE_CASE)
private val inlineLogo = Regex("^data:image/(svg\\+xml|png|webp);base64,")
private val latinInitials = Regex("^[A-Za-z0-9]{1,2}")
private val svgRoot = Regex("<svg(?:\\s|>)", RegexOption.IGNORE_CASE)
private val svgEntities = Regex("<!(DOCTYPE|ENTITY)\\b", RegexOption.IGNORE_CASE)

private fun logoSource(reference: String?, origin: String?): String? {
  if (reference.isNullOrBlank()) return null
  if (reference.length <= 176_000 && inlineLogo.containsMatchIn(reference)) return reference
  if (origin != null && logoPath.matches(reference) && !reference.contains("..") && !encodedSeparator.containsMatchIn(reference)) {
    return origin.trimEnd('/') + reference
  }
  return reference.takeIf { it.length <= 2048 && '\\' !in it }?.toHttpUrlOrNull()
    ?.takeIf { it.isHttps && it.username.isEmpty() && it.password.isEmpty() }?.toString()
}

private fun loadLogo(source: String): Bitmap? {
  val bytes = if (source.startsWith("data:")) Base64.getDecoder().decode(source.substringAfter(','))
  else logoHttp.newCall(Request.Builder().url(source).build()).execute().use { response ->
    val body = response.body ?: return null
    if (!response.isSuccessful || body.contentLength() > LOGO_LIMIT || body.source().request(LOGO_LIMIT + 1)) return null
    body.bytes()
  }
  val text = bytes.decodeToString()
  if (svgRoot.containsMatchIn(text)) {
    if (svgEntities.containsMatchIn(text)) return null
    val svg = SVG.getFromString(text)
    val bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
    Canvas(bitmap).drawPicture(svg.renderToPicture(128, 128))
    return bitmap
  }
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
  val dimension = maxOf(bounds.outWidth, bounds.outHeight)
  if (dimension !in 1..4096) return null
  val options = BitmapFactory.Options().apply {
    inSampleSize = Integer.highestOneBit((dimension / 128).coerceAtLeast(1))
  }
  return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
}

@Composable
internal fun CapabilityLogo(reference: String?, origin: String?, label: String, fallback: Int, extent: Dp = 48.dp) {
  val source = logoSource(reference, origin)
  val bitmap by key(source) {
    produceState(source?.let(logoCache::get)) {
      value = if (source == null) null else logoCache.get(source) ?: runInterruptible(Dispatchers.IO) {
        try { loadLogo(source)?.also { logoCache.put(source, it) } }
        catch (_: Exception) { null }
      }
    }
  }
  val colors = MaterialTheme.colorScheme
  val artwork = bitmap
  val tile = if (artwork == null) colors.primaryContainer
    else if (colors.background.luminance() < 0.5f) Color(0xFFF2F5F9) else colors.surfaceContainerLow
  Box(Modifier.size(extent).background(tile, themedCorners(14)), contentAlignment = Alignment.Center) {
    if (artwork != null) {
      Image(artwork.asImageBitmap(), null, Modifier.size(extent * 0.65f).testTag("capability-brand-loaded"))
    } else {
      val word = label.trim()
      val initials = latinInitials.find(word)?.value?.uppercase()
        ?: word.takeIf(String::isNotEmpty)?.let { String(Character.toChars(it.codePointAt(0))) }
      if (initials == null) ActionIcon(fallback, color = colors.primary, size = extent * 0.43f)
      else Text(initials, color = colors.onPrimaryContainer, fontSize = (extent.value * 0.39f).sp)
    }
  }
}
