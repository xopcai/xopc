/** User-role evidence may contain quoted instructions that carry no mutation authority. */
export function isUnquotedOwnerEvidence(text: string, quote: string): boolean {
  const author = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, '')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, span =>
      /忘记|忘掉|删除|清除|删掉|\b(?:forget|delete|erase|remove)\b/iu.test(span) ? '' : span)
    .replace(/^\s*>.*$/gmu, '');
  if (/(?:不要|别|不必|无需|禁止)(?:再)?(?:忘记|忘掉|删除|清除|删掉)|(?:do not|don't|never)\s+(?:forget|delete|erase|remove)/iu.test(author)) return false;
  if (!/忘记|忘掉|删除|删掉|清除|移除|(?:不再|不要再|别再)保存|\b(?:forget|delete|erase|remove)\b|(?:stop|don't|do not)\s+(?:remembering|retaining|storing|remember|retain|store)/iu.test(author)) return false;
  return !!quote.trim() && author.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase());
}
