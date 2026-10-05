package ai.xopc.mobile.theme

import ai.xopc.mobile.R
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test

class LanguagePreferenceTest {
  @Test fun selectedLanguageChangesResourcesAndSurvivesAnotherRead() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val previous = LanguagePreference.read(context)
    try {
      LanguagePreference.write(context, "zh-CN")
      assertEquals("zh-CN", LanguagePreference.read(context))
      assertEquals("设置", LanguagePreference.localizedContext(context).getString(R.string.settings_title))

      LanguagePreference.write(context, "en-US")
      assertEquals("Settings", LanguagePreference.localizedContext(context).getString(R.string.settings_title))

      LanguagePreference.write(context, "system")
      assertEquals("system", LanguagePreference.read(context))
      assertEquals(context.getString(R.string.settings_title),
        LanguagePreference.localizedContext(context).getString(R.string.settings_title))
    } finally {
      LanguagePreference.write(context, previous)
    }
  }
}
