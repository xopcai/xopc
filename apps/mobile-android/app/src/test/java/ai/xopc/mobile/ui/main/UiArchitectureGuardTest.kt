package ai.xopc.mobile.ui.main

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Architecture guard tests for the unified three-platform mobile design system on Android.
 * Mirrors HarmonyOS uiInteractionConsistency.test.ts and iOS UIArchitectureGuardTests.swift.
 */
class UiArchitectureGuardTest {

  private fun uiMainDir(): File {
    val candidates = listOf(
      File("src/main/java/ai/xopc/mobile/ui/main"),
      File("app/src/main/java/ai/xopc/mobile/ui/main"),
    )
    return candidates.firstOrNull { it.isDirectory }
      ?: error("Could not locate Android ui/main source directory from ${File(".").absolutePath}")
  }

  private fun uiMainKotlinFiles(): List<File> =
    uiMainDir().listFiles { f -> f.isFile && f.extension == "kt" }?.sortedBy { it.name }.orEmpty()

  @Test
  fun designTokensMatchThreePlatformSpec() {
    assertEquals(16f, XopcDesignTokens.PagePaddingX.value)
    assertEquals(20f, XopcDesignTokens.SheetPaddingX.value)
    assertEquals(8, XopcDesignTokens.RadiusXs)
    assertEquals(12, XopcDesignTokens.RadiusSm)
    assertEquals(16, XopcDesignTokens.RadiusMd)
    assertEquals(20, XopcDesignTokens.RadiusLg)
    assertEquals(36f, XopcDesignTokens.ButtonHeightSm.value)
    assertEquals(44f, XopcDesignTokens.ButtonHeightMd.value)
    assertEquals(48f, XopcDesignTokens.ButtonHeightLg.value)
  }

  @Test
  fun motionTokensMatchThreePlatformSpec() {
    assertEquals(140, XopcMotionTokens.MicroMs)
    assertEquals(180, XopcMotionTokens.ExitMs)
    assertEquals(220, XopcMotionTokens.StandardMs)
    assertEquals(230, XopcMotionTokens.PagerMs)
    assertEquals(280, XopcMotionTokens.EmphasisMs)
    assertEquals(1200, XopcMotionTokens.SkeletonMs)
  }

  @Test
  fun noRawModalBottomSheetOutsideMobileChrome() {
    val offenders = uiMainKotlinFiles()
      .filter { it.name != "MobileChrome.kt" }
      .filter { Regex("""\bModalBottomSheet\s*\(""").containsMatchIn(it.readText()) }
      .map { it.name }
    assertTrue("Use XopcBottomSheet instead of raw ModalBottomSheet in: $offenders", offenders.isEmpty())
  }

  @Test
  fun noRawPullToRefreshBoxOutsideMobileChrome() {
    val offenders = uiMainKotlinFiles()
      .filter { it.name != "MobileChrome.kt" }
      .filter { Regex("""(?<!Xopc)\bPullToRefreshBox\s*\(""").containsMatchIn(it.readText()) }
      .map { it.name }
    assertTrue("Use XopcPullToRefreshBox instead of raw PullToRefreshBox in: $offenders", offenders.isEmpty())
  }

  @Test
  fun noRawPageBackButtonOutsideSharedChrome() {
    val allowed = setOf("MobileChrome.kt", "PageSearch.kt")
    val offenders = uiMainKotlinFiles()
      .filter { it.name !in allowed }
      .filter { Regex("""\bPageBackButton\s*\(""").containsMatchIn(it.readText()) }
      .map { it.name }
    assertTrue("Use XopcPageHeader instead of hand-rolled PageBackButton in: $offenders", offenders.isEmpty())
  }

  @Test
  fun noHardcodedBusinessHexColorsInUiMain() {
    // Allowlist strictly brand mascot and capability icon fallback canvas.
    val allowed = setOf("LoopiIcon.kt", "CapabilityLogo.kt")
    val offenders = uiMainKotlinFiles()
      .filter { it.name !in allowed }
      .filter { Regex("""Color\(0x[0-9A-Fa-f]{6,8}\)""").containsMatchIn(it.readText()) }
      .map { it.name }
    assertTrue("Use semantic MaterialTheme/LocalStatusColors instead of hardcoded Color(0x...) in: $offenders", offenders.isEmpty())
  }

  @Test
  fun noDecorativeBorderStrokeInClarificationCard() {
    val clarification = File(uiMainDir(), "ClarificationCard.kt").readText()
    assertTrue(
      "ClarificationCard must follow borderless Calm Intelligence surface hierarchy",
      !clarification.contains("BorderStroke("),
    )
  }
}
