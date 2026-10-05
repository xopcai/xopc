package ai.xopc.mobile.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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
  MaterialTheme(colorScheme = colors, typography = Typography, content = content)
}
