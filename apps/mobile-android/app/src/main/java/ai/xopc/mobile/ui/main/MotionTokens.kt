package ai.xopc.mobile.ui.main

import android.animation.ValueAnimator
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

/** Unified Calm-Intelligence motion timing tokens (milliseconds), aligned with HarmonyOS motionTokens. */
internal object XopcMotionTokens {
  const val MicroMs: Int = 140
  const val ExitMs: Int = 180
  const val StandardMs: Int = 220
  const val PagerMs: Int = 230
  const val EmphasisMs: Int = 280
  const val SkeletonMs: Int = 1200

  val StandardEasing: CubicBezierEasing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
}

internal enum class XopcSheetPreset {
  Compact,
  Medium,
  Large,
  Immersive,
}

internal fun xopcMotionDuration(durationMs: Int, motionAllowed: Boolean): Int =
  if (!motionAllowed || durationMs <= 0) 0 else durationMs

internal fun xopcPagerAnimated(motionAllowed: Boolean, distance: Int = 1): Boolean =
  motionAllowed && kotlin.math.abs(distance) == 1

internal fun xopcSheetHeightFraction(preset: XopcSheetPreset): Float = when (preset) {
  XopcSheetPreset.Compact -> 0.50f
  XopcSheetPreset.Medium -> 0.72f
  XopcSheetPreset.Large -> 0.90f
  XopcSheetPreset.Immersive -> 0.94f
}

internal fun xopcSheetSkipPartiallyExpanded(preset: XopcSheetPreset): Boolean = when (preset) {
  XopcSheetPreset.Compact -> true
  XopcSheetPreset.Medium -> true
  XopcSheetPreset.Large -> true
  XopcSheetPreset.Immersive -> true
}

/** Observes system animator duration scale and foreground lifecycle for reduce-motion compliance. */
@Composable
internal fun rememberMotionAllowed(): Boolean {
  val context = LocalContext.current
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  var resumed by remember(lifecycle) {
    mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
  }
  DisposableEffect(lifecycle) {
    val observer = LifecycleEventObserver { _, _ ->
      resumed = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
    }
    lifecycle.addObserver(observer)
    onDispose { lifecycle.removeObserver(observer) }
  }
  var allowed by remember(context) { mutableStateOf(ValueAnimator.areAnimatorsEnabled()) }
  DisposableEffect(context) {
    val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
      override fun onChange(selfChange: Boolean) {
        allowed = ValueAnimator.areAnimatorsEnabled()
      }
    }
    context.contentResolver.registerContentObserver(
      Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
    onDispose { context.contentResolver.unregisterContentObserver(observer) }
  }
  return allowed && resumed
}

internal fun xopcScreenTransition(motionAllowed: Boolean): ContentTransform {
  val enterMs = xopcMotionDuration(XopcMotionTokens.ExitMs, motionAllowed)
  val exitMs = xopcMotionDuration(XopcMotionTokens.MicroMs, motionAllowed)
  return fadeIn(tween(enterMs, easing = XopcMotionTokens.StandardEasing)) togetherWith
    fadeOut(tween(exitMs, easing = XopcMotionTokens.StandardEasing))
}

internal fun xopcExpandPanelEnter(motionAllowed: Boolean, expandFrom: Alignment.Vertical = Alignment.Bottom): EnterTransition {
  val ms = xopcMotionDuration(XopcMotionTokens.StandardMs, motionAllowed)
  return expandVertically(animationSpec = tween(ms, easing = XopcMotionTokens.StandardEasing), expandFrom = expandFrom) +
    fadeIn(animationSpec = tween(ms))
}

internal fun xopcExpandPanelExit(motionAllowed: Boolean, shrinkTowards: Alignment.Vertical = Alignment.Bottom): ExitTransition {
  val ms = xopcMotionDuration(XopcMotionTokens.ExitMs, motionAllowed)
  return shrinkVertically(animationSpec = tween(ms, easing = XopcMotionTokens.StandardEasing), shrinkTowards = shrinkTowards) +
    fadeOut(animationSpec = tween(ms))
}
