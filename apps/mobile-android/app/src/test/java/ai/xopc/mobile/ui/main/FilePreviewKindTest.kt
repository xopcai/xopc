package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilePreviewKindTest {
  @Test fun recognizesRenderableDocumentsFromMimeOrExtension() {
    assertEquals(PreviewFileKind.MARKDOWN, previewFileKind("notes.md", "application/octet-stream"))
    assertEquals(PreviewFileKind.HTML, previewFileKind("page", "text/html; charset=utf-8"))
    assertEquals(PreviewFileKind.SVG, previewFileKind("drawing.svg", "image/svg+xml"))
    assertEquals(PreviewFileKind.PDF, previewFileKind("report.PDF", "application/octet-stream"))
    assertEquals(PreviewFileKind.TEXT, previewFileKind("data.json", "application/octet-stream"))
    assertEquals(PreviewFileKind.TEXT, previewFileKind("readme.txt", "text/plain"))
    assertEquals(PreviewFileKind.BINARY, previewFileKind("archive.zip", "application/zip"))
  }

  @Test fun bitmapFallbackHandlesMissingMimeWithoutStealingSvg() {
    assertTrue(isBitmapPreview("photo.PNG", "application/octet-stream"))
    assertFalse(isBitmapPreview("drawing.svg", "image/svg+xml"))
  }
}
