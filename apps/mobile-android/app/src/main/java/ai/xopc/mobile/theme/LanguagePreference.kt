package ai.xopc.mobile.theme

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

object LanguagePreference {
  private const val FILE = "xopc-language"
  private const val KEY = "language"
  val options = listOf("system", "zh-CN", "en-US")

  fun read(context: Context): String = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    .getString(KEY, "system")?.takeIf(options::contains) ?: "system"

  fun write(context: Context, language: String) {
    require(language in options)
    check(context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putString(KEY, language).commit())
  }

  fun localizedContext(base: Context): Context {
    val language = read(base)
    if (language == "system") return base
    val configuration = Configuration(base.resources.configuration)
    configuration.setLocale(Locale.forLanguageTag(language))
    return base.createConfigurationContext(configuration)
  }
}
