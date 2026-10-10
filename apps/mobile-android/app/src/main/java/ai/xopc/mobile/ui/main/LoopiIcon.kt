package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import android.animation.ValueAnimator
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
private fun rememberLoopiMotionAllowed(): Boolean {
  val context = LocalContext.current
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
  return allowed
}

/** The ring keeps its idle motion while greetings animate only the face. */
@Composable
internal fun LoopiIcon(extent: Dp, active: Boolean, compact: Boolean = false,
  interactive: Boolean = false, working: Boolean = false, modifier: Modifier = Modifier) {
  val motionAllowed = rememberLoopiMotionAllowed()
  val motionActive = active && motionAllowed
  var greeting by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  var greetingJob by remember { mutableStateOf<Job?>(null) }
  val label = stringResource(R.string.tab_assistant)
  val touchModifier = if (interactive) Modifier.clip(CircleShape).clickable(
    interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button,
    onClickLabel = label) {
    if (motionActive) {
      greetingJob?.cancel()
      greetingJob = scope.launch {
        greeting = true
        delay(450)
        greeting = false
      }
    }
  } else Modifier
  LaunchedEffect(motionActive) { if (!motionActive) greeting = false }
  Box(modifier = modifier.size(extent).then(touchModifier), contentAlignment = Alignment.Center) {
    if (motionActive) AnimatedLoopiArtwork(extent, compact, greeting, working)
    else LoopiArtwork(extent, ringLift = 0f, faceLift = 0f, ringAngle = 0f, eyeOpen = 1f)
  }
}

@Composable
private fun AnimatedLoopiArtwork(extent: Dp, compact: Boolean, greeting: Boolean, working: Boolean) {
  if (compact && !working) {
    CompactLoopiArtwork(extent)
    return
  }
  val cycle = rememberInfiniteTransition(label = "loopi-breathe")
  val breathing by cycle.animateFloat(initialValue = 0f, targetValue = 1f,
    animationSpec = infiniteRepeatable(tween(1700, easing = LinearEasing), RepeatMode.Reverse),
    label = "loopi-lift")
  val blink by cycle.animateFloat(initialValue = 1f, targetValue = 1f,
    animationSpec = infiniteRepeatable(keyframes {
      durationMillis = 4600
      1f at 0
      1f at 1400
      0.12f at 1510
      1f at 1690
    }), label = "loopi-blink")
  val greetingLift by animateFloatAsState(if (greeting) -2f else 0f,
    animationSpec = tween(if (greeting) 160 else 360), label = "loopi-greeting-lift")
  val greetingEyes by animateFloatAsState(if (greeting) 0.25f else 1f,
    animationSpec = tween(if (greeting) 160 else 180), label = "loopi-greeting-eyes")
  val lift = if (compact) -2f else -4f
  LoopiArtwork(extent, ringLift = lift * breathing,
    faceLift = lift * breathing + greetingLift,
    ringAngle = (if (compact) 0f else if (working) 2f else -1.2f) * breathing,
    eyeOpen = blink * greetingEyes)
}

@Composable
private fun CompactLoopiArtwork(extent: Dp) {
  val lift = remember { Animatable(0f) }
  val eyes = remember { Animatable(1f) }
  LaunchedEffect(Unit) {
    delay(120)
    lift.animateTo(-2f, tween(220))
    delay(40)
    eyes.animateTo(0.12f, tween(110))
    eyes.animateTo(1f, tween(180))
  }
  LoopiArtwork(extent, ringLift = lift.value, faceLift = lift.value,
    ringAngle = 0f, eyeOpen = eyes.value)
}

@Composable
private fun LoopiArtwork(extent: Dp, ringLift: Float, faceLift: Float,
  ringAngle: Float, eyeOpen: Float) {
  val extentPx = with(LocalDensity.current) { extent.toPx() }
  Box(modifier = Modifier.size(extent), contentAlignment = Alignment.Center) {
    Image(painterResource(R.drawable.loopi_ring), contentDescription = null,
      modifier = Modifier.size(extent).graphicsLayer {
        rotationZ = ringAngle
        translationY = ringLift * extentPx / 304f
      })
    Box(Modifier.size(extent).graphicsLayer { translationY = faceLift * extentPx / 200f },
      contentAlignment = Alignment.Center) {
      Image(painterResource(R.drawable.loopi_core), contentDescription = null, modifier = Modifier.size(extent))
      Canvas(modifier = Modifier.size(extent * (52f / 304f)).graphicsLayer {
        translationY = -2f * extentPx / 304f
      }) {
        val eyeHeight = size.width * (12.4f / 52f) * eyeOpen.coerceIn(0.08f, 1f)
        listOf(5f / 52f, 47f / 52f).forEach { x ->
          drawOval(Color(0xFF293438),
            topLeft = Offset(size.width * x - size.width * (4.4f / 52f), size.height / 2f - eyeHeight / 2f),
            size = Size(size.width * (8.8f / 52f), eyeHeight))
        }
      }
    }
  }
}
