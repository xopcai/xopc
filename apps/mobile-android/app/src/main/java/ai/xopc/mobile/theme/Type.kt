package ai.xopc.mobile.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private fun mobileText(size: Int, lineHeight: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
  fontFamily = FontFamily.SansSerif,
  fontWeight = weight,
  fontSize = size.sp,
  lineHeight = lineHeight.sp,
  letterSpacing = 0.sp,
)

// Match Harmony's page, row, body, and caption hierarchy using the platform sans-serif font.
val Typography = Typography(
  displayLarge = mobileText(36, 44, FontWeight.Bold),
  displayMedium = mobileText(32, 40, FontWeight.Bold),
  displaySmall = mobileText(28, 34, FontWeight.Bold),
  headlineLarge = mobileText(28, 34, FontWeight.Bold),
  headlineMedium = mobileText(24, 32, FontWeight.Bold),
  headlineSmall = mobileText(28, 34, FontWeight.Bold),
  titleLarge = mobileText(21, 29, FontWeight.Bold),
  titleMedium = mobileText(16, 23, FontWeight.Medium),
  titleSmall = mobileText(14, 20, FontWeight.Medium),
  bodyLarge = mobileText(16, 25),
  bodyMedium = mobileText(14, 21),
  bodySmall = mobileText(13, 19),
  labelLarge = mobileText(14, 20, FontWeight.Medium),
  labelMedium = mobileText(12, 18, FontWeight.Medium),
  labelSmall = mobileText(11, 16, FontWeight.Medium),
)
