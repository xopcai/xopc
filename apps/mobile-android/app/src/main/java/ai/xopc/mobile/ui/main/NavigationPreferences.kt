package ai.xopc.mobile.ui.main

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

internal class NavigationPreferences(private val preferences: SharedPreferences) {
  fun selection(key: String, options: Collection<String>, fallback: String): String =
    preferences.getString(key, fallback)?.takeIf(options::contains) ?: fallback

  fun rememberSelection(key: String, value: String) {
    preferences.edit().putString(key, value).apply()
  }
}

@Composable
internal fun rememberNavigationPreferences(): NavigationPreferences {
  val context = LocalContext.current.applicationContext
  return remember(context) { NavigationPreferences(context.getSharedPreferences("navigation", Context.MODE_PRIVATE)) }
}
