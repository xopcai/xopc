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

  @Test
  fun noDecorativeSurfaceBordersOrShadowsInUiMain() {
    val files = uiMainKotlinFiles()
    val borderStrokeOffenders = files.filter { it.readText().contains("BorderStroke(") }.map { it.name }
    assertTrue(
      "Use borderless layered surface colors instead of BorderStroke in: $borderStrokeOffenders",
      borderStrokeOffenders.isEmpty(),
    )
    val shadowOffenders = files.filter {
      val text = it.readText()
      text.contains("shadowElevation") || text.contains("tonalElevation")
    }.map { it.name }
    assertTrue(
      "Use flat layered surface colors instead of shadow/tonal elevation in: $shadowOffenders",
      shadowOffenders.isEmpty(),
    )
    val tabBar = File(uiMainDir(), "FloatingTabBar.kt").readText()
    val mainScreen = File(uiMainDir(), "MainScreen.kt").readText()
    assertTrue(
      "FloatingTabBar must use opaque scheme.surface via floatingPillSurfaceColor",
      tabBar.contains("internal fun floatingPillSurfaceColor(scheme: ColorScheme): Color = scheme.surface"),
    )
    assertTrue(
      "AssistantComposer must share floatingPillSurfaceColor with FloatingTabBar",
      mainScreen.contains("floatingPillSurfaceColor(composerScheme)"),
    )
  }

  @Test
  fun noRawToastMakeTextOutsideMobileChrome() {
    val offenders = uiMainKotlinFiles()
      .filter { it.name != "MobileChrome.kt" }
      .filter { Regex("""Toast\.makeText\s*\(""").containsMatchIn(it.readText()) }
      .map { it.name }
    assertTrue("Use xopcShowToast instead of raw Toast.makeText in: $offenders", offenders.isEmpty())
  }

  @Test
  fun noUnusedModalBottomSheetImportsOutsideMobileChrome() {
    val offenders = uiMainKotlinFiles()
      .filter { it.name != "MobileChrome.kt" }
      .filter { it.readText().contains("import androidx.compose.material3.ModalBottomSheet") }
      .map { it.name }
    assertTrue("Remove unused ModalBottomSheet imports in: $offenders", offenders.isEmpty())
  }

  @Test
  fun unifiedSearchFieldAndHorizontalPagerAdoptedAcrossCoreScreens() {
    for (file in listOf("CapabilitiesScreen.kt", "SpaceLibraryScreen.kt", "NotesScreen.kt", "MainScreen.kt")) {
      val text = File(uiMainDir(), file).readText()
      assertTrue("$file must adopt XopcPageSearchField", text.contains("XopcPageSearchField("))
    }
    for (file in listOf("MainScreen.kt", "SpaceLibraryScreen.kt")) {
      val text = File(uiMainDir(), file).readText()
      assertTrue("$file must not use swipePageSelection", !text.contains("swipePageSelection("))
      assertTrue("$file must disable horizontal swipe switching on its bottom-tab pager", text.contains("userScrollEnabled = false"))
    }
    val progress = File(uiMainDir(), "ProgressScreen.kt").readText()
    assertTrue("ProgressScreen workbench pager must disable horizontal swipe switching", progress.contains("userScrollEnabled = false"))
    val notes = File(uiMainDir(), "NotesScreen.kt").readText()
    assertTrue("NotesScreen must switch filters via PageTitleMenu without HorizontalPager",
      notes.contains("PageTitleMenu(") && !notes.contains("HorizontalPager("))
    val capabilities = File(uiMainDir(), "CapabilitiesScreen.kt").readText()
    val searchIdx = capabilities.indexOf("XopcPageSearchField(")
    val listIdx = capabilities.indexOf("XopcPullToRefreshBox(")
    assertTrue("CapabilitiesScreen must place search above list content", searchIdx in 0 until listIdx)
    assertTrue("CapabilitiesScreen must not show PageTitleMenu switcher", !capabilities.contains("PageTitleMenu("))
    assertTrue("CapabilitiesScreen must not use HorizontalPager", !capabilities.contains("HorizontalPager("))
    assertTrue("CapabilitiesScreen skill market button must use action_capabilities icon",
      capabilities.contains("R.drawable.action_capabilities"))
  }

  @Test
  fun auxiliarySemanticColorsMatchThreePlatformSpec() {
    val themeFile = File(uiMainDir().parentFile.parentFile, "theme/Theme.kt")
    val source = themeFile.readText()
    val requiredHex = listOf(
      "0x66000000", "0x73000000",
      "0xFFFFF2D2", "0xFF734600", "0xFF352C22", "0xFFFFBC63",
      "0xFFFDECEC", "0xFF382124",
      "0xFF176141", "0xFFE6F5EC", "0xFF66D89A", "0xFF1A2F24",
    )
    for (hex in requiredHex) {
      assertTrue("Theme.kt must define canonical three-platform semantic color $hex", source.contains(hex))
    }
  }

  @Test
  fun listSkeletonsSheetHeadersHapticsAndExpandMotionAdopted() {
    val segmentedTabs = File(uiMainDir(), "SegmentedTabs.kt").readText()
    assertTrue("SegmentedTabs must trigger haptic feedback on tab switch", segmentedTabs.contains("LocalHapticFeedback"))

    for (file in listOf("NotesScreen.kt", "MainScreen.kt", "AboutYouScreen.kt", "AutomationScreens.kt", "PersonalScreen.kt", "ProgressScreen.kt")) {
      val text = File(uiMainDir(), file).readText()
      assertTrue("$file must adopt XopcListSkeleton for list loading", text.contains("XopcListSkeleton("))
    }

    for (file in listOf("ChatOptionsPanel.kt", "ConversationShareSheet.kt", "PersonalAgentProfileSheet.kt", "ModelSettingsScreen.kt", "MainScreen.kt", "PersonalScreen.kt")) {
      val text = File(uiMainDir(), file).readText()
      assertTrue("$file must adopt XopcSheetHeader", text.contains("XopcSheetHeader("))
    }

    for (file in listOf("MainScreen.kt", "NotesScreen.kt", "AutomationScreens.kt", "ProgressScreen.kt")) {
      val text = File(uiMainDir(), file).readText()
      assertTrue("$file must animate expandable search/filter with xopcExpandPanelEnter", text.contains("xopcExpandPanelEnter("))
    }
  }

  @Test
  fun transparentFloatingHeadersAndCapsuleChromeAdoptedAcrossPages() {
    val chrome = File(uiMainDir(), "MobileChrome.kt").readText()
    assertTrue("MobileChrome must provide XopcFloatingHeaderScaffold", chrome.contains("fun XopcFloatingHeaderScaffold("))
    assertTrue("MobileChrome must provide XopcHeaderIconButton", chrome.contains("fun XopcHeaderIconButton("))
    assertTrue("MobileChrome must render static XopcPageHeader title in a CircleShape capsule",
      chrome.contains("shape = CircleShape,\n            color = floatingPillSurfaceColor"))

    val pageSearch = File(uiMainDir(), "PageSearch.kt").readText()
    assertTrue("PageTitleMenu must render in a CircleShape capsule", pageSearch.contains("shape = CircleShape"))
    assertTrue("PageSearchButton must delegate to XopcHeaderIconButton", pageSearch.contains("XopcHeaderIconButton("))

    for (file in listOf(
      "MainScreen.kt", "NotesScreen.kt", "ProgressScreen.kt", "SpaceLibraryScreen.kt",
      "CapabilitiesScreen.kt", "AboutYouScreen.kt", "SettingsScreen.kt", "PersonalScreen.kt",
      "ShareCenterScreen.kt", "GatewayProfilesScreen.kt", "ModelSettingsScreen.kt", "VoiceNoteScreen.kt",
    )) {
      val text = File(uiMainDir(), file).readText()
      assertTrue("$file must host its header in XopcFloatingHeaderScaffold", text.contains("XopcFloatingHeaderScaffold("))
    }

    val taskChat = File(uiMainDir(), "TaskChatChrome.kt").readText()
    assertTrue("TaskChatChrome header must remain transparent", !taskChat.contains(".height(64.dp).background(MaterialTheme.colorScheme.background)"))
  }
}
