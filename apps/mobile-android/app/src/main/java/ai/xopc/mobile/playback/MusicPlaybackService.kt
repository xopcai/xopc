package ai.xopc.mobile.playback

import ai.xopc.mobile.MainActivity
import ai.xopc.mobile.R
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

internal data class MusicTrack(
  val gatewayId: String, val conversationId: String, val id: String, val title: String,
  val sourceTitle: String, val lyrics: String? = null, val durationMs: Int = 0,
  val fileName: String? = null,
) {
  val key: String get() = "$gatewayId/$conversationId/$id"
}

internal enum class MusicPhase { Loading, Playing, Paused, Ended, Failed }

internal data class MusicState(
  val track: MusicTrack, val phase: MusicPhase, val positionMs: Int = 0, val durationMs: Int = track.durationMs,
)

internal data class MusicRequest(
  val track: MusicTrack, val playbackUrl: suspend () -> String, val download: suspend (File) -> Unit,
)

internal object MusicPlayback {
  private val mutable = MutableStateFlow<MusicState?>(null)
  val state = mutable.asStateFlow()
  internal var service: MusicPlaybackService? = null
  internal var request: MusicRequest? = null

  fun play(context: Context, track: MusicTrack, playbackUrl: suspend () -> String, download: suspend (File) -> Unit) {
    if (mutable.value?.track?.key == track.key) { toggle(context); return }
    request = MusicRequest(track, playbackUrl, download)
    mutable.value = MusicState(track, MusicPhase.Loading)
    start(context, MusicPlaybackService.Action.Load)
  }

  fun toggle(context: Context) {
    val current = mutable.value ?: return
    when (current.phase) {
      MusicPhase.Loading, MusicPhase.Playing -> pause()
      MusicPhase.Paused, MusicPhase.Ended -> {
        service?.resume() ?: start(context, MusicPlaybackService.Action.Load)
      }
      MusicPhase.Failed -> start(context, MusicPlaybackService.Action.Load)
    }
  }

  private fun start(context: Context, action: MusicPlaybackService.Action) {
    try {
      ContextCompat.startForegroundService(context, Intent(context, MusicPlaybackService::class.java).setAction(action.name))
    } catch (_: RuntimeException) {
      mutable.value = mutable.value?.copy(phase = MusicPhase.Failed)
    }
  }

  fun pause() { service?.pause() ?: run { mutable.value = mutable.value?.copy(phase = MusicPhase.Paused) } }

  fun seek(position: Int) { service?.seek(position) }

  fun stop() {
    request = null
    mutable.value = null
    service?.stopTrack()
  }

  internal fun update(state: MusicState) {
    if (request?.track?.key == state.track.key) mutable.value = state
  }
}

class MusicPlaybackService : Service() {
  internal enum class Action { Load, Play, Pause, Stop }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private lateinit var session: MediaSession
  private lateinit var audio: AudioManager
  private lateinit var focus: AudioFocusRequest
  private var foreground = false
  private var focusHeld = false
  private var current: MusicRequest? = null
  private var player: MediaPlayer? = null
  private var load: Job? = null
  private var progress: Job? = null
  private var playWhenReady = true
  private var phase = MusicPhase.Loading
  private var duration = 0
  private var position = 0
  private val positions by lazy { getSharedPreferences("generated-music-resume", MODE_PRIVATE) }
  private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()

  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) pause()
    }
  }

  override fun onCreate() {
    super.onCreate()
    MusicPlayback.service = this
    audio = getSystemService(AudioManager::class.java)
    focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
      .setWillPauseWhenDucked(true).setOnAudioFocusChangeListener { change ->
        if (change < 0) pause()
      }.build()
    val notifications = getSystemService(NotificationManager::class.java)
    notifications.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.music_notification_channel),
      NotificationManager.IMPORTANCE_LOW))
    session = MediaSession(this, "xopc-music").apply {
      setSessionActivity(activityIntent())
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() { onPlayCommand() }
        override fun onPause() { pause() }
        override fun onStop() { MusicPlayback.stop() }
        override fun onSeekTo(pos: Long) { seek(pos.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()) }
      })
    }
    ContextCompat.registerReceiver(this, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
      ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      Action.Load.name -> {
        val request = MusicPlayback.request
        if (request == null) {
          promote()
          stopTrack()
        } else prepare(request, shouldPlay = MusicPlayback.state.value?.phase != MusicPhase.Paused)
      }
      Action.Play.name -> onPlayCommand()
      Action.Pause.name -> pause()
      Action.Stop.name -> MusicPlayback.stop()
      else -> if (current == null) stopSelf(startId)
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun prepare(request: MusicRequest, shouldPlay: Boolean) {
    savePosition()
    clearPlayer()
    current = request
    playWhenReady = shouldPlay
    phase = MusicPhase.Loading
    position = positions.getInt(request.track.key, 0).coerceAtLeast(0)
    duration = request.track.durationMs.coerceAtLeast(0)
    try {
      publish()
      promote()
    } catch (_: RuntimeException) {
      fail()
      return
    }
    load = scope.launch {
      try {
        val url = request.playbackUrl()
        if (current !== request || MusicPlayback.request !== request) return@launch
        createPlayer(url, request)
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (_: Exception) {
        if (current === request) fail()
      }
    }
  }

  private fun createPlayer(url: String, request: MusicRequest) {
    val native = MediaPlayer()
    player = native
    native.setAudioAttributes(attributes)
    native.setOnPreparedListener {
      if (player !== native || MusicPlayback.request !== request) return@setOnPreparedListener
      duration = native.duration.coerceAtLeast(0)
      val saved = position.takeIf { it in 1 until duration } ?: 0
      phase = MusicPhase.Paused
      position = saved
      if (saved > 0) native.seekTo(saved.toLong(), MediaPlayer.SEEK_CLOSEST)
      if (playWhenReady) resume() else { publish(); leaveForeground() }
    }
    native.setOnCompletionListener {
      if (player !== native) return@setOnCompletionListener
      position = duration
      phase = MusicPhase.Ended
      savePosition()
      abandonFocus()
      stopProgress()
      publish()
      leaveForeground()
    }
    native.setOnErrorListener { _, _, _ ->
      if (player === native) fail()
      true
    }
    native.setDataSource(url)
    native.prepareAsync()
  }

  private fun onPlayCommand() {
    if (phase == MusicPhase.Failed || current == null) MusicPlayback.request?.let { prepare(it, true) }
    else resume()
  }

  internal fun resume() {
    if (current == null) return
    playWhenReady = true
    if (phase == MusicPhase.Loading || phase == MusicPhase.Playing) return
    val native = player ?: return
    try {
      promote()
      if (!focusHeld) focusHeld = audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      if (!focusHeld) { pause(); return }
      if (phase == MusicPhase.Ended) {
        position = 0
        native.seekTo(0L, MediaPlayer.SEEK_CLOSEST)
      }
      native.start()
      phase = MusicPhase.Playing
      publish()
      progress?.cancel()
      progress = scope.launch {
        while (phase == MusicPhase.Playing && player === native) {
          updatePosition()
          delay(400)
        }
      }
    } catch (_: Exception) { fail() }
  }

  internal fun pause() {
    playWhenReady = false
    if (phase == MusicPhase.Loading) return
    if (phase == MusicPhase.Playing) {
      updatePosition()
      runCatching { player?.pause() }
      phase = MusicPhase.Paused
    }
    savePosition()
    stopProgress()
    abandonFocus()
    publish()
    leaveForeground()
  }

  internal fun seek(positionMs: Int) {
    if (phase !in setOf(MusicPhase.Playing, MusicPhase.Paused, MusicPhase.Ended) || duration <= 0) return
    val native = player ?: return
    position = positionMs.coerceIn(0, duration)
    if (phase == MusicPhase.Ended) phase = MusicPhase.Paused
    runCatching { native.seekTo(position.toLong(), MediaPlayer.SEEK_CLOSEST) }
      .onFailure { fail(); return }
    savePosition()
    publish()
  }

  internal fun stopTrack() {
    updatePosition()
    savePosition()
    clearPlayer()
    current = null
    session.isActive = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    foreground = false
    getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
    stopSelf()
  }

  private fun updatePosition() {
    if (phase != MusicPhase.Playing) return
    val active = player ?: return
    position = runCatching { active.currentPosition }.getOrDefault(position)
    current?.track?.let { MusicPlayback.update(MusicState(it, phase, position, duration)) }
  }

  private fun savePosition() {
    val track = current?.track ?: return
    positions.edit().putInt(track.key, if (phase == MusicPhase.Ended || duration > 0 && position >= duration) 0 else position).apply()
  }

  private fun stopProgress() { progress?.cancel(); progress = null }

  private fun abandonFocus() {
    if (focusHeld) { focusHeld = false; audio.abandonAudioFocusRequest(focus) }
  }

  private fun clearPlayer() {
    load?.cancel()
    load = null
    stopProgress()
    abandonFocus()
    player?.release()
    player = null
  }

  private fun fail() {
    updatePosition()
    savePosition()
    clearPlayer()
    phase = MusicPhase.Failed
    publish()
    leaveForeground()
  }

  private fun publish() {
    val track = current?.track ?: return
    MusicPlayback.update(MusicState(track, phase, position, duration))
    session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_MEDIA_ID, track.id)
      .putString(MediaMetadata.METADATA_KEY_TITLE, track.title).putString(MediaMetadata.METADATA_KEY_ARTIST, track.sourceTitle)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, duration.toLong()).build())
    val state = when (phase) {
      MusicPhase.Loading -> PlaybackState.STATE_BUFFERING
      MusicPhase.Playing -> PlaybackState.STATE_PLAYING
      MusicPhase.Paused, MusicPhase.Ended -> PlaybackState.STATE_PAUSED
      MusicPhase.Failed -> PlaybackState.STATE_ERROR
    }
    val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
      PlaybackState.ACTION_STOP or if (duration > 0) PlaybackState.ACTION_SEEK_TO else 0L
    session.setPlaybackState(PlaybackState.Builder().setActions(actions)
      .setState(state, position.toLong(), if (phase == MusicPhase.Playing) 1f else 0f, SystemClock.elapsedRealtime()).build())
    session.isActive = true
    if (phase != MusicPhase.Loading || foreground)
      getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
  }

  private fun promote() {
    if (foreground) return
    ServiceCompat.startForeground(this, NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    foreground = true
  }

  private fun leaveForeground() {
    if (foreground) {
      stopForeground(STOP_FOREGROUND_DETACH)
      foreground = false
    }
  }

  private fun activityIntent() = PendingIntent.getActivity(this, 0,
    Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun command(action: Action) = PendingIntent.getService(this, action.ordinal,
    Intent(this, MusicPlaybackService::class.java).setAction(action.name),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun notification(): Notification {
    val track = current?.track
    val playing = phase == MusicPhase.Playing || phase == MusicPhase.Loading
    return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.action_waveform)
      .setContentTitle(track?.title ?: getString(R.string.music_notification_channel))
      .setContentText(track?.sourceTitle.orEmpty()).setContentIntent(activityIntent())
      .setCategory(Notification.CATEGORY_TRANSPORT).setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true).setOngoing(playing).setDeleteIntent(command(Action.Stop))
      .addAction(Notification.Action.Builder(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        getString(if (playing) R.string.music_pause else R.string.music_play), command(if (playing) Action.Pause else Action.Play)).build())
      .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,
        getString(R.string.music_stop), command(Action.Stop)).build())
      .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1)).build()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    if (phase != MusicPhase.Playing && phase != MusicPhase.Loading) MusicPlayback.stop()
  }

  override fun onDestroy() {
    updatePosition()
    savePosition()
    if (phase == MusicPhase.Playing || phase == MusicPhase.Loading) current?.track?.let {
      MusicPlayback.update(MusicState(it, MusicPhase.Paused, position, duration))
    }
    clearPlayer()
    scope.cancel()
    unregisterReceiver(noisy)
    session.release()
    if (MusicPlayback.service === this) MusicPlayback.service = null
    super.onDestroy()
  }

  private companion object {
    const val CHANNEL = "generated-music"
    const val NOTIFICATION = 42
  }
}
