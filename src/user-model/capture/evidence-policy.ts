import type { AssertionAuthority, AssertionKind, AssertionVolatility, UserModelScopeType } from '../domain.js';

export interface OwnerSupport {
  allowed: boolean;
  direct: boolean;
  reason?: 'non_owner_content' | 'temporary_context' | 'local_instruction' | 'unsupported_attribution';
  fingerprint: string;
}

/** Extraction can only name operations supported by the execution-context consumer. */
export function supportsResponseApplicability(applicability: Record<string, unknown> = {}): boolean {
  const operation = applicability.operation;
  return operation === undefined || operation === 'response'
    || (Array.isArray(operation) && operation.length > 0 && operation.every(value => value === 'response'));
}

const SELF = /(?:我(?:自己|本人|平时|一般|通常|长期|一直|一贯|更|比较|还是|现在|最|特别|主要|也|其实|的|经常|习惯|倾向|偏好|喜欢|希望|需要|是|叫|住|会|用|选)|对我来说)|\b(?:i|my|me|mine)\b/iu;
const DIRECT_PREFERENCE = /我(?:自己|本人)?(?:一直|长期|一贯|平时|通常|一般|也|更|比较|最|特别)?(?:不|不太|并不|不再)?(?:喜欢|偏好|习惯|倾向|希望)|(?:我|我的).{0,12}(?:长期习惯|阅读习惯|沟通习惯|固定偏好)|以后|今后|从现在起|from now on|\bi (?:prefer|like|always|usually)\b|\b(?:whenever you|always (?:use|start|lead|reply|answer)|works? (?:best|better) for me|my preference|keep (?:answers|responses) concise)\b/iu;
const FOREIGN = /客户|同事|别人|他人|朋友说|原话|原文|引用|引文|翻译|润色|改写|示例|台词|角色|假设|假如|虚构|不是我的|并非我的|\b(?:quote|quoted|translate|rewrite|example|fiction|hypothetical|suppose|customer|colleague)\b/iu;
const HYPOTHETICAL = /假设|假如|如果我|要是我|倘若|虚构|角色设定|(?:不是|并非).{0,8}(?:我|自述|事实)|\b(?:hypothetical|suppose|if i|fictional|role.?play)\b/iu;
const TEMPORARY = /这次|本次|今天|今晚|暂时|临时|现在先|目前先|这一轮|这周|本周|\b(?:this time|today|tonight|for now|just for|this week|this turn)\b/iu;
const LOCAL_INSTRUCTION = /(?:只|仅)(?:需|要)?(?:回复|回答|输出)|这(?:个|张|次).{0,12}(?:标题|海报|按钮|改成)|\b(?:reply|answer|output) (?:only|just)|\b(?:this title|this button)\b/iu;
const CHOICE = /我选|我还是选|选.{0,12}(?:版|种|项)|这版|更顺|更好读|容易扫读|\b(?:i (?:choose|pick)|option|version|easier to (?:read|scan))\b/iu;

function maskNonOwnerSpans(raw: string): string {
  let result = raw.normalize('NFKC');
  const mask = (match: string) => match.replace(/[^\r\n]/gu, ' ');
  result = result.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, mask)
    .replace(/^\s*>[^\n]*/gmu, mask)
    .replace(/<(?:quote|blockquote|untrusted_text)\b[^>]*>[\s\S]*?<\/(?:quote|blockquote|untrusted_text)>/giu, mask);
  // Quoted preference values are valid when an owner statement introduces them.
  const original = result;
  result = result.replace(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"\n]+"|(?<!\p{L})'[^'\n]+'(?!\p{L})/gu, (match, offset: number) => {
    const prefix = original.slice(Math.max(0, offset - 100), offset).split(/[。.；;!?！？\n]/u).at(-1) ?? '';
    return SELF.test(prefix) && !FOREIGN.test(prefix) ? match : mask(match);
  });
  return result;
}

const SCOPE_CLAUSE = /[^。.；;!?！？\n]+/gu;
const LOCAL_SCOPE_PREFIX = '(?:在|只|仅|限于|用于|(?:只|仅)(?:限于?|在|用于|对)?)';
const LOCAL_SCOPE_CONTEXT = '(?:本|该|这个|当前)';
const LOCAL_SCOPE = [
  ['session', '(?:会话|对话)', '(?:仅|只)在?这次对话', '(?:conversation|session|chat)'],
  ['agent', '(?:助手|智能体)', '', '(?:agent|assistant)'],
  ['project', '项目', `${LOCAL_SCOPE_CONTEXT}项目(?:里|中|内|的|以后|今后|统一|都)`, 'project'],
  ['workspace', '工作区', `${LOCAL_SCOPE_CONTEXT}工作区(?:里|中|内|的|以后|今后|统一|都)`, 'workspace'],
] as const;
const LOCAL_SCOPE_PATTERNS = LOCAL_SCOPE.map(([type, noun, additional, english]) => ({
  type,
  pattern: new RegExp([
    `${LOCAL_SCOPE_PREFIX}${LOCAL_SCOPE_CONTEXT}${noun}`,
    `\\b(?:in|for|with) (?:this|(?:the |my )?current) ${english}\\b`,
    `\\bonly.{0,20}(?:this|current) ${english}\\b`,
    additional,
  ].filter(Boolean).join('|'), 'iu'),
}));
const GLOBAL_SCOPE = /全局(?:范围|生效|适用|默认|记忆|偏好|协作规则)|(?:改成|改为|设为)全局|跨项目(?:使用|适用|生效|通用)|(?:所有|每个|任何)\s*(?:项目|工作区|助手|会话|协作)|\b(?:globally|global (?:scope|memory|preference|rule)|(?:make|set|change) .{1,30} global|across (?:all )?(?:projects|workspaces|assistants|conversations)|(?:in|for) (?:all|every|any) (?:projects?|workspaces?|assistants?|conversations?))\b/iu;
const NOT_GLOBAL = /(?:不要|禁止|不能|不必|不应|不)(?:再|要|得)?(?:设为|用于|适用于|在|跨)?\s*(?:全局|所有项目|跨项目)|\b(?:not|never|don't|do not)\s+(?:apply |use |share |save )?(?:it )?(?:globally|across (?:all )?projects|in (?:all|other) projects)\b/iu;

function ownerClauses(text: string, quote: string): string[] {
  const normalized = quote.normalize('NFKC').trim();
  if (!normalized) return [];
  const source = text.normalize('NFKC');
  const at = source.indexOf(normalized);
  if (at < 0) return [];
  const end = at + normalized.length;
  return [...maskNonOwnerSpans(source).matchAll(SCOPE_CLAUSE)]
    .filter(match => match.index < end && match.index + match[0].length > at)
    .map(match => match[0]);
}

/** Read scope qualifiers in the containing owner clause, including words outside the selected quote. */
export function ownerMemoryScope(text: string, quote: string): UserModelScopeType | undefined {
  const clauses = ownerClauses(text, quote);
  const local = LOCAL_SCOPE_PATTERNS.find(({ pattern }) => clauses.some(clause => pattern.test(clause)));
  if (local) return local.type;
  return !clauses.some(clause => NOT_GLOBAL.test(clause)) && clauses.some(clause => GLOBAL_SCOPE.test(clause)) ? 'global' : undefined;
}

export function ownerExcludesGlobalScope(text: string, quote: string): boolean {
  return ownerClauses(text, quote).some(clause => NOT_GLOBAL.test(clause));
}

export function isStandingToolInstruction(text: string, quote: string): boolean {
  return ownerClauses(text, quote).some(clause =>
    /记住|以后|今后|统一|一律|始终|\b(?:remember|whenever|always|from now on)\b/iu.test(clause)
    && /(?:查询|搜索|读取|检索|\b(?:search|query|read|look up|fetch)\b)/iu.test(clause)
    && /(?:统一走|用.{0,35}(?:工具|命令|浏览器|连接器|CLI|API)|\b(?:use|run)\b.{0,55}\b(?:tool|command|browser|connector|CLI|API)\b)/iu.test(clause));
}

/** A durable tool instruction can cover every matching operation in just one project. */
export function standingToolScope(text: string, quote: string, hasProject: boolean): UserModelScopeType | undefined {
  if (!isStandingToolInstruction(text, quote)) return undefined;
  return ownerMemoryScope(text, quote) ?? (hasProject ? 'project' : 'workspace');
}

/** Inspect the source clause, not merely the extractor's chosen substring or authority label. */
export function assessOwnerSupport(input: {
  text: string;
  quote: string;
  kind?: AssertionKind;
  authority?: AssertionAuthority;
  volatility?: AssertionVolatility;
  validTo?: number;
  observedAt?: number;
}): OwnerSupport {
  const source = input.text.normalize('NFKC');
  const quote = input.quote.normalize('NFKC');
  const masked = maskNonOwnerSpans(source);
  const at = source.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
  if (at < 0) return { allowed: false, direct: false, reason: 'unsupported_attribution', fingerprint: '' };
  const segment = masked.slice(at, at + quote.length).trim();
  const left = source.slice(0, at).search(/[^。.；;!?！？\n]*$/u);
  const tail = source.slice(at + quote.length).search(/[。.；;!?！？\n]/u);
  const end = tail < 0 ? source.length : at + quote.length + tail;
  const clause = masked.slice(left < 0 ? 0 : left, end).trim();
  const reject = (reason: OwnerSupport['reason']): OwnerSupport => ({ allowed: false, direct: false, reason, fingerprint: '' });
  if (masked.slice(at, at + quote.length).replace(/\s+/gu, '') !== source.slice(at, at + quote.length).replace(/\s+/gu, '')) return reject('non_owner_content');
  if (!segment || !clause) return reject('non_owner_content');
  const before = source.slice(left < 0 ? 0 : left, at);
  if (/(?:翻译|润色|改写|客户说|同事说|别人说|\b(?:translate|rewrite|customer said|colleague said)\b)/iu.test(before)
    && !/(?:另外|而我|我自己|我本人|but i|personally)/iu.test(before)) return reject('non_owner_content');
  if (/^(?:(?:请|帮我|麻烦|把).{0,35}(?:翻译|润色|改写|原话|引用|示例)|(?:translate|rewrite|customer said|colleague said)\b)/iu.test(clause)
    && !/(?:另外|而我|but i|personally)/iu.test(clause)) return reject('non_owner_content');
  if (HYPOTHETICAL.test(clause)) return reject('non_owner_content');
  const local = LOCAL_INSTRUCTION.test(clause) && !DIRECT_PREFERENCE.test(clause);
  if (local) return reject('local_instruction');
  const temporary = TEMPORARY.test(clause) && !/从今天起|从现在起|from (?:today|now) on/iu.test(clause);
  if (temporary && (input.kind !== 'current_state' || !Number.isFinite(input.validTo)
    || input.validTo! <= (input.observedAt ?? 0))) return reject('temporary_context');
  if (input.kind === 'current_state' && !Number.isFinite(input.validTo)) return reject('temporary_context');
  const direct = input.kind === 'preference' || input.kind === 'routine'
    ? DIRECT_PREFERENCE.test(segment) || DIRECT_PREFERENCE.test(clause) || hasOwnerMemoryDirective(clause, 'remember')
    : SELF.test(clause) || DIRECT_PREFERENCE.test(clause);
  if (!direct && !SELF.test(segment) && !CHOICE.test(segment)) return reject('unsupported_attribution');
  return { allowed: true, direct, fingerprint: segment.toLocaleLowerCase().replace(/\s+/gu, ' ').trim() };
}

export function hasOwnerMemoryDirective(text: string, command: 'remember' | 'correct' | 'forget' | 'confirm'): boolean {
  const owned = maskNonOwnerSpans(text);
  const pattern = {
    remember: /记住|记下|保存.{0,12}(?:偏好|习惯|事实|记忆)|\bremember\b/iu,
    correct: /纠正|更正|修正|改成|改为|\b(?:correct|instead|change to)\b/iu,
    forget: /忘记|忘掉|删除.{0,12}(?:偏好|习惯|事实|记忆)|\bforget\b/iu,
    confirm: /确认.{0,12}(?:偏好|习惯|事实|记忆|这条)|\b(?:confirm|that is correct)\b/iu,
  }[command];
  return owned.split(/[。.；;!?！？\n]/u).some(clause => pattern.test(clause) && !HYPOTHETICAL.test(clause)
    && !/(?:不要|别|不必|并非|不是).{0,6}(?:记住|保存|删除|忘记|确认)|\b(?:don't|do not|never)\b/iu.test(clause));
}

/** Re-evaluate authority and independent support at both parse and commit boundaries. */
export function assessAssertionSupport(input: {
  kind: AssertionKind;
  authority: AssertionAuthority;
  volatility: AssertionVolatility;
  validTo?: number;
  observedAt: number;
  action: 'create' | 'merge' | 'replace';
  sources: Array<{ ref: string; role: string; text: string; quote: string }>;
}): { allowed: boolean; authority: AssertionAuthority; reasonCode?: string } {
  const reject = (reasonCode: string) => ({ allowed: false, authority: input.authority, reasonCode });
  if (!input.sources.length || input.sources.some(source => source.role !== 'user')) return reject('owner_evidence_missing');
  const supports = input.sources.map(source => assessOwnerSupport({ ...input, text: source.text, quote: source.quote }));
  const invalid = supports.find(support => !support.allowed);
  if (invalid) return reject(invalid.reason ?? 'unsupported_attribution');
  const direct = supports.some((support, index) => support.direct || hasOwnerMemoryDirective(input.sources[index].text, 'remember'));
  const authority = input.authority === 'user_explicit' && !direct ? 'user_observed' : input.authority;
  if (authority === 'user_observed' || authority === 'system_inferred') {
    const distinctSources = new Set(input.sources.map(source => source.text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim())).size;
    const independentQuotes = new Set(supports.map(support => support.fingerprint)).size;
    if (input.action !== 'merge' && Math.min(distinctSources, independentQuotes) < 2) return reject('independent_owner_support_required');
  }
  return { allowed: true, authority };
}

/** Source attribution for work facts does not require a first-person user statement. */
export function isOwnerAuthoredSpan(text: string, quote: string): boolean {
  const source = text.normalize('NFKC');
  const at = source.indexOf(quote.normalize('NFKC'));
  if (at < 0) return false;
  const owned = maskNonOwnerSpans(source).slice(at, at + quote.normalize('NFKC').length).trim();
  return Boolean(owned) && !HYPOTHETICAL.test(owned);
}

/** Mutating an existing memory requires an entirely owned span, not mixed quoted and owned text. */
export function isFullyOwnerAuthoredSpan(text: string, quote: string): boolean {
  const source = text.normalize('NFKC');
  const normalized = quote.normalize('NFKC');
  const at = source.indexOf(normalized);
  return at >= 0 && isOwnerAuthoredSpan(text, quote)
    && maskNonOwnerSpans(source).slice(at, at + normalized.length).replace(/\s/gu, '') === normalized.replace(/\s/gu, '');
}

/** A bounded repair hint; these clauses remain subject to normal model and host admission. */
export function directPreferenceClauses(text: string): string[] {
  const result: string[] = [];
  for (const match of text.matchAll(/[^。.；;!?！？\n]+/gu)) {
    const quote = match[0].trim();
    if (!DIRECT_PREFERENCE.test(quote)) continue;
    const support = assessOwnerSupport({ text, quote, kind: 'preference' });
    if (support.allowed && support.direct) result.push(quote);
    if (result.length === 4) break;
  }
  return result;
}

/** Choices remain observations; these hints never authorize an explicit user fact. */
export function observedChoiceClauses(text: string): string[] {
  const result: string[] = [];
  for (const match of text.matchAll(/[^。.；;!?！？\n]+/gu)) {
    const quote = match[0].trim();
    if (!CHOICE.test(quote)) continue;
    const support = assessOwnerSupport({ text, quote, kind: 'preference' });
    if (support.allowed && !support.direct) result.push(quote);
    if (result.length === 2) break;
  }
  return result;
}
