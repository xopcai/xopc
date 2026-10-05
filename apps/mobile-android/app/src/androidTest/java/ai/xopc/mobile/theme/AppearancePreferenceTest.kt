package ai.xopc.mobile.theme

import androidx.test.core.app.ApplicationProvider
import android.content.Context
import org.junit.Assert.assertEquals
import androidx.compose.ui.graphics.Color
import org.junit.Test

class AppearancePreferenceTest {
  @Test fun displayModeSurvivesAStoreReRead() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val original = AppearancePreference.read(context)
    val originalScheme = AppearancePreference.readScheme(context)
    try {
      AppearancePreference.write(context, "dark")
      assertEquals("dark", AppearancePreference.read(context))
      AppearancePreference.write(context, "light")
      assertEquals("light", AppearancePreference.read(context))
      AppearancePreference.writeScheme(context, "porcelain")
      assertEquals("porcelain", AppearancePreference.readScheme(context))
    } finally {
      AppearancePreference.write(context, original)
      AppearancePreference.writeScheme(context, originalScheme)
    }
  }

  @Test fun harmonyPaletteValuesCoverLightAndDarkVariants() {
    assertEquals(Color(0xFFF6F0E7), xopcPalette("porcelain", false).surface)
    assertEquals(Color(0xFF211C19), xopcPalette("porcelain", true).surface)
    assertEquals(Color(0xFF059669), xopcPalette("emerald", false).accent)
    assertEquals(Color(0xFFFFB084), xopcPalette("clay", true).accent)
    assertEquals(Color(0xFF3A6BFF), xopcPalette("default", false).accent)
    assertEquals(xopcPalette("default", true), xopcPalette("unknown", true))
  }
}
