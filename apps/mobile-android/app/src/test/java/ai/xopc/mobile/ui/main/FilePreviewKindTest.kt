package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

  @Test fun safePreviewHtmlKeepsCspBeforeUntrustedMarkupAndBlocksSvgScripts() {
    val bypassed = safePreviewHtml("<script>window.x=1</script><head></head><body>ok</body>", enableScripts = true)
    assertTrue(bypassed.indexOf("Content-Security-Policy") < bypassed.indexOf("<script>"))
    val svg = safePreviewHtml("<svg><script>alert(1)</script></svg>", enableScripts = false)
    assertTrue(svg.contains("script-src 'none'"))
  }

  @Test fun mathAssetAllowlistBlocksTraversalAndServesFonts() {
    assertEquals("text/html", MathMarkdownSyntax.allowedAssetMime("index.html"))
    assertEquals("font/woff2", MathMarkdownSyntax.allowedAssetMime("fonts/KaTeX_Main-Regular.woff2"))
    assertNull(MathMarkdownSyntax.allowedAssetMime("../charts/index.html"))
    assertNull(MathMarkdownSyntax.allowedAssetMime("fonts/../secret.woff2"))
  }
}
