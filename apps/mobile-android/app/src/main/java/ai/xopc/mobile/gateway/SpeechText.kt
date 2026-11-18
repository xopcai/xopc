package ai.xopc.mobile.gateway

private const val FIRST_CHUNK_LIMIT = 160
private const val CHUNK_LIMIT = 420
private val sentenceBreaks = Regex("""[。！？!?]+["'”’」』）)]*|\.+["'”’」』）)]*(?=\s)|\n+""")
private val clauseBreaks = Regex("""[，、；：]|[,;:](?=\s)""")
private val wordBreaks = Regex("""\s""")

internal fun speakableText(markdown: String): String = markdown
  .replace(Regex("```[\\s\\S]*?```|~~~[\\s\\S]*?~~~"), "\n")
  .replace(Regex("xopc-product-delivery:\\S+"), "")
  .replace(Regex("!\\[([^]]*)]\\([^)]+\\)"), "$1")
  .replace(Regex("\\[([^]]+)]\\([^)]+\\)"), "$1")
  .replace(Regex("https?://\\S+", RegexOption.IGNORE_CASE), "")
  .replace(Regex("^#{1,6}\\s+", RegexOption.MULTILINE), "")
  .replace(Regex("^\\s*[-*+]\\s+", RegexOption.MULTILINE), "")
  .replace(Regex("^\\s*\\d+[.)]\\s+", RegexOption.MULTILINE), "")
  .replace(Regex("[|`*_~>]"), " ")
  .replace(Regex("<[^>]+>"), " ")
  .replace(Regex("[\\t ]+"), " ")
  .replace(Regex(" *\\n *"), "\n")
  .replace(Regex("\\n{3,}"), "\n\n")
  .trim()

internal fun speechLanguage(text: String, fallback: String): String {
  val han = text.count { it in '\u3400'..'\u9fff' }
  val latin = text.count { it in 'A'..'Z' || it in 'a'..'z' }
  return if (han == 0 && latin == 0) {
    if (fallback.startsWith("zh")) "zh-CN" else "en-US"
  } else if (han * 2 >= latin) "zh-CN" else "en-US"
}

internal fun speechChunks(markdown: String): List<String> {
  var rest = speakableText(markdown)
  var limit = FIRST_CHUNK_LIMIT
  val chunks = mutableListOf<String>()
  while (rest.length > limit) {
    val window = rest.substring(0, limit + 1)
    var end = lastBreak(window, sentenceBreaks, limit)
      ?: lastBreak(window, clauseBreaks, limit)
      ?: lastBreak(window, wordBreaks, limit)
      ?: limit
    if (rest[end - 1].isHighSurrogate()) end--
    chunks.add(rest.substring(0, end).trim())
    rest = rest.substring(end).trimStart()
    limit = CHUNK_LIMIT
  }
  if (rest.isNotEmpty()) chunks.add(rest)
  return chunks
}

private fun lastBreak(window: String, pattern: Regex, limit: Int): Int? =
  pattern.findAll(window).map { it.range.last + 1 }.lastOrNull { it in (limit / 2)..limit }
