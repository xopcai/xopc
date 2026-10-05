package ai.xopc.mobile.gateway

import android.content.Context
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/** Owns only the temporary camera output; ChatAttachmentStore owns the encrypted snapshot. */
object CameraCaptureStore {
  private const val DIRECTORY = "camera-capture"
  private const val MAX_AGE_MS = 24L * 60 * 60 * 1000
  private val NAME = Regex("[0-9a-fA-F-]{36}\\.jpg")

  fun create(context: Context): Uri {
    val directory = File(context.cacheDir, DIRECTORY)
    check(directory.isDirectory || directory.mkdirs()) { "CAMERA_CACHE_UNAVAILABLE" }
    val cutoff = System.currentTimeMillis() - MAX_AGE_MS
    directory.listFiles()?.filter { it.isFile && NAME.matches(it.name) && it.lastModified() < cutoff }
      ?.forEach(File::delete)
    val file = File(directory, "${UUID.randomUUID()}.jpg")
    check(file.createNewFile()) { "CAMERA_CACHE_UNAVAILABLE" }
    return try { FileProvider.getUriForFile(context, authority(context), file) }
    catch (error: Exception) { file.delete(); throw error }
  }

  fun discard(context: Context, uri: Uri) {
    if (uri.scheme != "content" || uri.authority != authority(context)) return
    val name = uri.lastPathSegment ?: return
    if (!NAME.matches(name)) return
    val file = File(File(context.cacheDir, DIRECTORY), name)
    if (runCatching { FileProvider.getUriForFile(context, authority(context), file) }.getOrNull() == uri) {
      file.delete()
    }
  }

  private fun authority(context: Context) = "${context.packageName}.camera-capture"
}

/** Grants the camera app access to this one FileProvider output, not the capture directory. */
class CameraTakePictureContract : ActivityResultContracts.TakePicture() {
  override fun createIntent(context: Context, input: Uri): Intent =
    super.createIntent(context, input).apply {
      clipData = ClipData.newUri(context.contentResolver, "camera-output", input)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    }
}
