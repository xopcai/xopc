package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionTokensTest {
  @Test
  fun respectsReduceMotionPreference() {
    assertEquals(0, xopcMotionDuration(XopcMotionTokens.StandardMs, motionAllowed = false))
    assertEquals(XopcMotionTokens.StandardMs, xopcMotionDuration(XopcMotionTokens.StandardMs, motionAllowed = true))
    assertEquals(0, xopcMotionDuration(0, motionAllowed = true))
    assertEquals(0, xopcMotionDuration(-50, motionAllowed = true))
  }

  @Test
  fun animatesOnlyAdjacentPagerStepsWhenMotionAllowed() {
    assertTrue(xopcPagerAnimated(motionAllowed = true, distance = 1))
    assertTrue(xopcPagerAnimated(motionAllowed = true, distance = -1))
    assertFalse(xopcPagerAnimated(motionAllowed = true, distance = 2))
    assertFalse(xopcPagerAnimated(motionAllowed = false, distance = 1))
  }

  @Test
  fun sheetPresetsMatchCrossMobileContract() {
    assertEquals(0.50f, xopcSheetHeightFraction(XopcSheetPreset.Compact))
    assertEquals(0.72f, xopcSheetHeightFraction(XopcSheetPreset.Medium))
    assertEquals(0.90f, xopcSheetHeightFraction(XopcSheetPreset.Large))
    assertEquals(0.94f, xopcSheetHeightFraction(XopcSheetPreset.Immersive))
    XopcSheetPreset.entries.forEach { preset ->
      assertTrue(xopcSheetSkipPartiallyExpanded(preset))
    }
  }
}
