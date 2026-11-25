package ai.xopc.mobile.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

@Composable
fun XopcTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  scheme: String = "default",
  content: @Composable () -> Unit,
) {
  val preset = scheme.takeIf(AppearancePreference.schemes::contains) ?: "default"
  val palette = xopcPalette(preset, darkTheme)
  val onAccent = if (palette.accent.luminance() > 0.179f) Color.Black else Color.White
  val colors = if (darkTheme) darkColorScheme(
    primary = palette.accent, onPrimary = onAccent,
    primaryContainer = palette.accentSoft, onPrimaryContainer = palette.foreground,
    background = palette.surface, onBackground = palette.foreground,
    surface = palette.panel, onSurface = palette.foreground,
    surfaceContainer = palette.input, surfaceContainerLow = palette.grouped,
    surfaceContainerHigh = palette.active, surfaceContainerHighest = palette.active,
    outlineVariant = palette.border,
    secondary = palette.secondary, onSecondary = palette.panel,
    secondaryContainer = palette.grouped, onSecondaryContainer = palette.foreground,
    tertiary = palette.accent, onTertiary = onAccent,
    tertiaryContainer = palette.accentSoft, onTertiaryContainer = palette.foreground,
    error = palette.danger, onError = if (palette.danger.luminance() > 0.179f) Color.Black else Color.White,
    onSurfaceVariant = palette.secondary, outline = palette.border,
  ) else lightColorScheme(
    primary = palette.accent, onPrimary = onAccent,
    primaryContainer = palette.accentSoft, onPrimaryContainer = palette.foreground,
    background = palette.surface, onBackground = palette.foreground,
    surface = palette.panel, onSurface = palette.foreground,
    surfaceContainer = palette.input, surfaceContainerLow = palette.grouped,
    surfaceContainerHigh = palette.active, surfaceContainerHighest = palette.active,
    outlineVariant = palette.border,
    secondary = palette.secondary, onSecondary = palette.panel,
    secondaryContainer = palette.grouped, onSecondaryContainer = palette.foreground,
    tertiary = palette.accent, onTertiary = onAccent,
    tertiaryContainer = palette.accentSoft, onTertiaryContainer = palette.foreground,
    error = palette.danger, onError = if (palette.danger.luminance() > 0.179f) Color.Black else Color.White,
    onSurfaceVariant = palette.secondary, outline = palette.border,
  )
  val factor = when (preset) {
    "emerald" -> 0.8f
    "clay" -> 1.2f
    else -> 1f
  }
  val shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp * factor),
    small = RoundedCornerShape(12.dp * factor),
    medium = RoundedCornerShape(16.dp * factor),
    large = RoundedCornerShape(20.dp * factor),
    extraLarge = RoundedCornerShape(28.dp * factor),
  )
  CompositionLocalProvider(
    LocalCornerScale provides factor,
    LocalChatColors provides chatColors(preset, darkTheme, palette),
    LocalAttentionColors provides attentionColors(darkTheme),
    LocalStatusColors provides statusColors(darkTheme, palette),
    LocalClarificationThemeColors provides clarificationThemeColors(preset, darkTheme, palette, colors),
  ) {
    MaterialTheme(colorScheme = colors, typography = Typography, shapes = shapes, content = content)
  }
}


private val LocalCornerScale = staticCompositionLocalOf { 1f }

@Composable
internal fun themedCorners(radius: Int, scale: Float = 1f): RoundedCornerShape =
  RoundedCornerShape(radius.dp * LocalCornerScale.current * scale)

internal const val CHAT_MESSAGE_WIDTH = 0.84f

internal data class ChatColors(
  val assistant: Color,
  val user: Color,
  val card: Color,
  val action: Color,
  val onAction: Color,
  val reaction: Color,
)

internal val LocalChatColors = staticCompositionLocalOf { chatColors("default", false, xopcPalette("default", false)) }

internal data class AttentionColors(val fill: Color, val foreground: Color)

internal val LocalAttentionColors = staticCompositionLocalOf { attentionColors(false) }

private fun attentionColors(dark: Boolean): AttentionColors = if (dark) {
  AttentionColors(Color(0xFF352C22), Color(0xFFFFBC63))
} else {
  AttentionColors(Color(0xFFFFF2D2), Color(0xFF734600))
}

internal data class StatusColors(
  val success: Color,
  val successSoft: Color,
  val dangerSoft: Color,
  val scrim: Color,
)

internal val LocalStatusColors = staticCompositionLocalOf {
  statusColors(false, xopcPalette("default", false))
}

private fun statusColors(dark: Boolean, palette: XopcPalette): StatusColors = if (dark) {
  StatusColors(
    success = Color(0xFF66D89A),
    successSoft = Color(0xFF1A2F24),
    dangerSoft = Color(0xFF382124),
    scrim = Color(0x73000000),
  )
} else {
  StatusColors(
    success = Color(0xFF187B49),
    successSoft = Color(0xFFE6F5EC),
    dangerSoft = palette.danger.copy(alpha = 0.12f),
    scrim = Color(0x66000000),
  )
}

internal data class ClarificationThemeColors(
  val surface: Color,
  val grouped: Color,
  val divider: Color,
  val border: Color,
  val primaryText: Color,
  val secondaryText: Color,
  val tertiaryText: Color,
  val accent: Color,
  val onAccent: Color,
  val accentSoft: Color,
  val accentText: Color,
  val tonalFill: Color,
  val tonalText: Color,
  val inputFill: Color,
  val badgeAmberFill: Color,
  val badgeAmberTint: Color,
  val danger: Color,
)

internal val LocalClarificationThemeColors = staticCompositionLocalOf {
  val p = xopcPalette("default", false)
  clarificationThemeColors("default", false, p, lightColorScheme(primary = p.accent, error = p.danger))
}

private fun clarificationThemeColors(
  scheme: String,
  dark: Boolean,
  palette: XopcPalette,
  colors: androidx.compose.material3.ColorScheme,
): ClarificationThemeColors {
  val badgeAmberFill = if (dark) Color(0x29F59E0B) else Color(0xFFFEF3E2)
  val badgeAmberTint = if (dark) Color(0xFFFBBF24) else Color(0xFFB45309)
  if (scheme == "default") {
    return if (dark) {
      ClarificationThemeColors(
        surface = Color(0xFF1E222A),
        grouped = Color(0xFF262B35),
        divider = Color(0x12FFFFFF),
        border = Color(0x17FFFFFF),
        primaryText = Color(0xFFF3F5F8),
        secondaryText = Color(0xFF9CA5B4),
        tertiaryText = Color(0xFF6C7585),
        accent = Color(0xFF3A6BFF),
        onAccent = Color.White,
        accentSoft = Color(0x2E4C82FF),
        accentText = Color(0xFF96B6FF),
        tonalFill = Color(0x14FFFFFF),
        tonalText = Color(0xFFE6EAF0),
        inputFill = Color(0xFF161920),
        badgeAmberFill = badgeAmberFill,
        badgeAmberTint = badgeAmberTint,
        danger = colors.error,
      )
    } else {
      ClarificationThemeColors(
        surface = Color.White,
        grouped = Color(0xFFF5F6F8),
        divider = Color(0x0F0F172A),
        border = Color(0x140F172A),
        primaryText = Color(0xFF111318),
        secondaryText = Color(0xFF5F6672),
        tertiaryText = Color(0xFF8E95A2),
        accent = Color(0xFF3A6BFF),
        onAccent = Color.White,
        accentSoft = Color(0xFFEDF3FF),
        accentText = Color(0xFF2B5CE6),
        tonalFill = Color(0xFFEFF1F5),
        tonalText = Color(0xFF1D2129),
        inputFill = Color.White,
        badgeAmberFill = badgeAmberFill,
        badgeAmberTint = badgeAmberTint,
        danger = colors.error,
      )
    }
  }
  return ClarificationThemeColors(
    surface = palette.panel,
    grouped = palette.grouped,
    divider = if (dark) Color(0x14FFFFFF) else Color(0x12000000),
    border = if (dark) Color(0x1AFFFFFF) else Color(0x14000000),
    primaryText = palette.foreground,
    secondaryText = palette.secondary,
    tertiaryText = palette.secondary.copy(alpha = 0.72f),
    accent = colors.primary,
    onAccent = colors.onPrimary,
    accentSoft = colors.primaryContainer,
    accentText = colors.primary,
    tonalFill = palette.grouped,
    tonalText = palette.foreground,
    inputFill = palette.panel,
    badgeAmberFill = badgeAmberFill,
    badgeAmberTint = badgeAmberTint,
    danger = colors.error,
  )
}

// Keep reply surfaces and chat actions in sync with HarmonyOS.
private fun chatColors(scheme: String, dark: Boolean, palette: XopcPalette): ChatColors {
  val assistant = if (dark) palette.input else palette.panel
  val reaction = if (dark) palette.active else palette.panel
  val onAction = if (dark) palette.surface else Color.White
  return when (scheme to dark) {
    "porcelain" to false -> ChatColors(assistant, Color(0xFFE9E0D5), Color(0xFFE8DED3),
      Color(0xFF844633), onAction, reaction)
    "porcelain" to true -> ChatColors(assistant, Color(0xFF4E392E), Color(0xFF302822),
      Color(0xFFE4AE98), onAction, reaction)
    "emerald" to false -> ChatColors(assistant, Color(0xFFE0EBE4), Color(0xFFDFEBE3),
      Color(0xFF087446), onAction, reaction)
    "emerald" to true -> ChatColors(assistant, Color(0xFF223D2F), Color(0xFF14221B),
      Color(0xFF78DDB0), onAction, reaction)
    "clay" to false -> ChatColors(assistant, Color(0xFFEBE5DB), Color(0xFFEAE1D3),
      Color(0xFF705430), onAction, reaction)
    "clay" to true -> ChatColors(assistant, Color(0xFF284540), Color(0xFF1A2B2A),
      Color(0xFFFFB084), onAction, reaction)
    "default" to true -> ChatColors(assistant, Color(0xFF2D394D), Color(0xFF222730),
      Color(0xFFA8BCFF), onAction, reaction)
    else -> ChatColors(assistant, Color(0xFFC7D5E7), palette.panel, palette.accent, onAction, reaction)
  }
}
