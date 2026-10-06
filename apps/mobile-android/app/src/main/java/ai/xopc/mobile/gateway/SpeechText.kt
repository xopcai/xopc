package ai.xopc.mobile.gateway

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
  val source = speakableText(markdown)
  if (source.isEmpty()) return emptyList()
  val units = Regex("[^。！？!?.\\n]+[。！？!?.]?|\\n+").findAll(source)
    .map { it.value.trim() }.filter(String::isNotEmpty).toList()
  val chunks = mutableListOf<String>()
  var current = ""
  fun split(value: String, limit: Int) {
    var offset = 0
    while (offset < value.length) {
      var end = minOf(value.length, offset + limit)
      if (end < value.length && value[end - 1].isHighSurrogate()) end--
      value.substring(offset, end).trim().takeIf(String::isNotEmpty)?.let(chunks::add)
      offset = end
    }
  }
  split(units.first(), 80)
  for (unit in units.drop(1)) {
    if (unit.length > 240) {
      current.trim().takeIf(String::isNotEmpty)?.let(chunks::add)
      current = ""
      split(unit, 240)
    } else {
      if (current.length + unit.length > 240) {
        current.trim().takeIf(String::isNotEmpty)?.let(chunks::add)
        current = ""
      }
      current += unit
    }
  }
  current.trim().takeIf(String::isNotEmpty)?.let(chunks::add)
  return chunks
}
