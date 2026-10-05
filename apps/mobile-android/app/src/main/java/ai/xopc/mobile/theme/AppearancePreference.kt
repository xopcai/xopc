package ai.xopc.mobile.theme

import android.content.Context

object AppearancePreference {
  private const val KEY = "display-mode"
  private const val SCHEME_KEY = "color-scheme"
  private const val FILE = "xopc-appearance"
  val schemes = listOf("default", "porcelain", "dawn", "emerald", "clay")

  fun read(context: Context): String = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    .getString(KEY, "system")?.takeIf { it in setOf("system", "light", "dark") } ?: "system"

  fun write(context: Context, mode: String) {
    require(mode in setOf("system", "light", "dark"))
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, mode).apply()
  }

  fun readScheme(context: Context): String = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    .getString(SCHEME_KEY, "default")?.takeIf(schemes::contains) ?: "default"

  fun writeScheme(context: Context, scheme: String) {
    require(scheme in schemes)
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(SCHEME_KEY, scheme).apply()
  }
}
