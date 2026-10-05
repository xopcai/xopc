package ai.xopc.mobile

import android.os.Bundle
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import ai.xopc.mobile.theme.AppearancePreference
import ai.xopc.mobile.theme.LanguagePreference
import ai.xopc.mobile.theme.XopcTheme

class MainActivity : ComponentActivity() {
  override fun attachBaseContext(newBase: Context) {
    super.attachBaseContext(LanguagePreference.localizedContext(newBase))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.Theme_Xopc)
    super.onCreate(savedInstanceState)

    enableEdgeToEdge()
    setContent {
      var appearanceMode by remember { mutableStateOf(AppearancePreference.read(this)) }
      var colorScheme by remember { mutableStateOf(AppearancePreference.readScheme(this)) }
      val systemDark = isSystemInDarkTheme()
      XopcTheme(darkTheme = when (appearanceMode) {
        "dark" -> true
        "light" -> false
        else -> systemDark
      }, scheme = colorScheme) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
          MainNavigation(appearanceMode, { mode ->
            AppearancePreference.write(this, mode); appearanceMode = mode
          }, colorScheme, { scheme ->
            AppearancePreference.writeScheme(this, scheme); colorScheme = scheme
          }, LanguagePreference.read(this), { language ->
            if (language != LanguagePreference.read(this)) {
              LanguagePreference.write(this, language)
              recreate()
            }
          })
        }
      }
    }
  }
}
