package ai.xopc.mobile.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

@Composable
fun XopcTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  scheme: String = "default",
  content: @Composable () -> Unit,
) {
  val palette = xopcPalette(scheme, darkTheme)
  val onAccent = if (palette.accent.luminance() > 0.45f) Color.Black else Color.White
  val colors = if (darkTheme) darkColorScheme(
    primary = palette.accent, onPrimary = onAccent,
    primaryContainer = palette.accentSoft, onPrimaryContainer = palette.foreground,
    background = palette.surface, onBackground = palette.foreground,
    surface = palette.panel, onSurface = palette.foreground,
    surfaceContainer = palette.input, surfaceContainerLow = palette.grouped,
    onSurfaceVariant = palette.secondary, outline = palette.border,
  ) else lightColorScheme(
    primary = palette.accent, onPrimary = onAccent,
    primaryContainer = palette.accentSoft, onPrimaryContainer = palette.foreground,
    background = palette.surface, onBackground = palette.foreground,
    surface = palette.panel, onSurface = palette.foreground,
    surfaceContainer = palette.input, surfaceContainerLow = palette.grouped,
    onSurfaceVariant = palette.secondary, outline = palette.border,
  )
  CompositionLocalProvider(LocalChatColors provides chatColors(scheme, darkTheme, palette.surface)) {
    MaterialTheme(colorScheme = colors, typography = Typography, content = content)
  }
}


internal const val CHAT_MESSAGE_WIDTH = 0.84f

internal data class ChatColors(
  val assistant: Color,
  val user: Color,
  val card: Color,
  val action: Color,
  val onAction: Color,
)

internal val LocalChatColors = staticCompositionLocalOf { chatColors("default", false, xopcPalette("default", false).surface) }

// The Chat surfaces mirror the HarmonyOS presets.
private fun chatColors(scheme: String, dark: Boolean, pageBackground: Color): ChatColors {
  return when (scheme) {
    "porcelain" -> if (dark) {
      ChatColors(Color(0xFF483B34), Color(0xFF372B24), Color(0xFF302822),
        Color(0xFFE4AE98), pageBackground)
    } else {
      ChatColors(Color(0xFFFFFFFF), Color(0xFFE9E0D5), Color(0xFFE8DED3),
        Color(0xFF844633), Color.White)
    }
    "dawn" -> if (dark) {
      ChatColors(Color(0xFF37495F), Color(0xFF26394D), Color(0xFF253547),
        Color(0xFFAFD5FB), pageBackground)
    } else {
      ChatColors(Color(0xFFFFFFFF), Color(0xFFDFE6EF), Color(0xFFE0E8F2),
        Color(0xFF245781), Color.White)
    }
    "emerald" -> if (dark) {
      ChatColors(Color(0xFF253D30), Color(0xFF172B21), Color(0xFF14221B),
        Color(0xFF78DDB0), pageBackground)
    } else {
      ChatColors(Color(0xFFFFFFFF), Color(0xFFE0EBE4), Color(0xFFDFEBE3),
        Color(0xFF087446), Color.White)
    }
    "clay" -> if (dark) {
      ChatColors(Color(0xFF2B4342), Color(0xFF1B3030), Color(0xFF1A2B2A),
        Color(0xFFFFB084), pageBackground)
    } else {
      ChatColors(Color(0xFFFFFFFF), Color(0xFFEBE5DB), Color(0xFFEAE1D3),
        Color(0xFF705430), Color.White)
    }
    else -> if (dark) {
      ChatColors(Color(0xFF343F50), Color(0xFF252F40), Color(0xFF222730),
        Color(0xFFA8BCFF), pageBackground)
    } else {
      ChatColors(Color(0xFFFFFFFF), Color(0xFFE4E7EC), Color(0xFFE2E8F1),
        Color(0xFF2453D6), Color.White)
    }
  }
}
