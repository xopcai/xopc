package ai.xopc.mobile

import ai.xopc.mobile.theme.LanguagePreference
import android.content.Context
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class LanguageActivityTest {
  @get:Rule val rule = createAndroidComposeRule<MainActivity>()

  @Test fun activityRecreationAppliesSavedLanguage() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val previous = LanguagePreference.read(context)
    try {
      LanguagePreference.write(context, "zh-CN")
      rule.activityRule.scenario.recreate()
      rule.activityRule.scenario.onActivity { activity ->
        assertEquals("设置", activity.getString(R.string.settings_title))
      }
      LanguagePreference.write(context, "en-US")
      rule.activityRule.scenario.recreate()
      rule.activityRule.scenario.onActivity { activity ->
        assertEquals("Settings", activity.getString(R.string.settings_title))
      }
    } finally {
      LanguagePreference.write(context, previous)
    }
  }
}
