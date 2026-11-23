// 第 4 步统一校验规则集：纯函数，无 Vue 依赖，前端即时反馈与服务端二次校验共用同一口径。

export const STATUSES = ['意向公示', '正在招标', '终止招标', '完成招标']
// 监管地区已改由全国三级行政区划数据驱动（utils/regions.js + public/data/regions.json），
// 不再使用演示用的 5 个模拟省市常量。
export const METHODS = ['公开招标', '邀请招标', '竞争性谈判', '竞争性磋商', '询价采购', '单一来源']
export const TYPES = ['货物类', '工程类', '服务类']
export const DOC_WAYS = ['线上', '线下']
export const CORRECTION_ITEMS = ['采购公告', '采购文件', '采购结果', '其它更正']

const SHORT_HOSTS = /^(bit\.ly|t\.cn|dwz\.cn|sina\.lt|is\.gd|tinyurl\.com|goo\.gl|tiny\.cc|url\.cn|suo\.im|m\.rw\.com)/i
// 日期：分隔符 - / . 均兼容；日期与时间之间允许任意空格 / T；时间支持 H:M[:S]
const DATE_RE = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[\sT]+(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?)?\s*$/
// 金额单位 -> 换算到「元」的倍率。内置元/万元/亿元，业务配置页可停用或扩展（第 7 步）。
let AMOUNT_UNITS = { '元': 1, '万元': 10000, '亿元': 100000000 }
export function setAmountUnits(map) {
  const next = { '元': 1, '万元': 10000, '亿元': 100000000 }   // 内置保底，防止配置把单位清空
  if (map && typeof map === 'object') {
    Object.keys(map).forEach(function (k) {
      const name = String(k).trim()
      const f = Number(map[k])
      if (name && Number.isSafeInteger(f) && f > 0) next[name] = f
    })
  }
  AMOUNT_UNITS = next
}
export function getAmountUnits() { return Object.assign({}, AMOUNT_UNITS) }
const URL_RE = /^(https?):\/\/([^\/\s]+)(\/\S*)?$/i

function p2(n) { return String(n).padStart(2, '0') }

/* ---------- 空格过滤（防坑 K-9 / 11.1） ---------- */

// 返回过滤后的值；trimEnds 为 true 时去掉首尾空格（blur 阶段才做，避免打断打字）
export function stripSpaces(value, rule, trimEnds = false) {
  let s = String(value == null ? '' : value)
  if (rule === 'multiline' || rule === 'address') {
    s = s.replace(/[ \t]+/g, ' ')
    if (trimEnds) s = s.trim()
    return s
  }
  return s.replace(/\s+/g, '')
}

/* ---------- 日期 / 日期时间（防坑 K-5） ---------- */

/**
 * 日期/时间粘贴兼容（第 7 轮紧急修复）：
 *  - 中文年月日 2026年11月13日 / 2026 年 11 月 13 日
 *  - 分隔符 - / .，如 2026/11/13、2026.11.13
 *  - 任意数量空格（含全角 \u3000）、T 分隔，中文时分秒 9时3分
 *  - 不标准时分秒 9:3 -> 09:03:00；纯日期字段只保留 YYYY-MM-DD
 * 统一输出 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss；无法识别返回 null。
 */
export function normalizeDateText(value, withTime) {
  let s = String(value == null ? '' : value)
    .replace(/\u3000/g, ' ')                       // 全角空格统一成半角
    .trim()
  if (!s) return ''
  s = s.replace(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g, '$1-$2-$3')
  s = s.replace(/(\d{1,2})\s*时/g, '$1:')
       .replace(/(\d{1,2})\s*分/g, '$1:')
       .replace(/(\d{1,2})\s*秒/g, '$1')
       .replace(/：/g, ':')
       .replace(/:\s*$/, '')                        // 9时3分 -> 9:3: -> 9:3
  const m = DATE_RE.exec(s)
  if (!m) return null
  const mo = Number(m[2]), day = Number(m[3])
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
  const date = m[1] + '-' + p2(mo) + '-' + p2(day)
  if (!withTime) return date
  const hh = Number(m[4] || 0), mm = Number(m[5] || 0), ss = Number(m[6] || 0)
  if (hh > 23 || mm > 59 || ss > 59) return null
  return date + ' ' + p2(hh) + ':' + p2(mm) + ':' + p2(ss)
}

export function isEarlierEnd(start, end) {
  const a = String(start == null ? '' : start).trim()
  const b = String(end == null ? '' : end).trim()
  if (!a || !b) return false
  return b < a   // 固定 YYYY-MM-DD / YYYY-MM-DD HH:mm:ss，字典序即时间序
}

/* ---------- 网址（11.5-6） ---------- */

export function urlOk(value) {
  const s = String(value == null ? '' : value).trim()
  if (!s) return true
  const m = URL_RE.exec(s)
  if (!m) return false
  const host = m[2].toLowerCase().replace(/^www\./, '')
  if (!/^https?$/i.test(m[1])) return false
  if (!host.includes('.')) return false
  if (SHORT_HOSTS.test(host)) return false
  return true
}

/* ---------- 金额识别与换算（10.1 / 10.2 / 防坑 K-1） ---------- */

// 十进制字符串 × 任意正整数倍率：BigInt 定点运算，绝不经过浮点，小数位如实保留。
// 这样业务配置里新增任意倍率的单位（如 千元=1000）也能精确换算。
function scaleDecimal(s, factor) {
  const parts = s.split('.')
  const dec = parts[1] || ''
  const scale = 10n ** BigInt(dec.length)
  const n = BigInt(parts[0]) * scale + BigInt(dec || '0')
  const prod = n * BigInt(factor)
  const intPart = prod / scale
  const rem = prod % scale
  if (rem === 0n) return intPart.toString()
  return intPart.toString() + '.' + rem.toString().padStart(dec.length, '0').replace(/0+$/, '')
}

// 「元」文本 -> 万元两位展示（BigInt 精确四舍五入，不用浮点）
function wanText(yuan) {
  const p = yuan.split('.')
  let f = BigInt(p[0]) * 100n + BigInt(((p[1] || '') + '00').slice(0, 2))
  if ((p[1] || '').length >= 3 && Number(p[1][2]) >= 5) f += 1n
  const cents = (f + 5000n) / 10000n   // 0.01 万元 = 10000 分
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0')
}

// 全角 -> 半角：数字 / 字母 / 标点 / 括号统一映射，全角空格与全角人民币符号单独处理。
export function toHalfWidth(raw) {
  return String(raw == null ? '' : raw).replace(/[\uFF01-\uFF5E\u3000\uFFE5]/g, function (ch) {
    if (ch === '\u3000') return ' '
    if (ch === '\uFFE5') return '¥'
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  })
}

function escapeCharClass(s) { return String(s).replace(/[\\\]^-]/g, '\\$&') }

// 可配置单位 + 缺失「元」字的短写（万 / 亿）。短写倍率跟随配置里的 万元 / 亿元，
// 不进入 getAmountUnits()，避免污染业务配置下拉。
function unitEntries() {
  const list = Object.keys(AMOUNT_UNITS).map(function (name) {
    return { name: name, factor: AMOUNT_UNITS[name] || 1 }
  })
  if (!AMOUNT_UNITS['万']) list.push({ name: '万', factor: AMOUNT_UNITS['万元'] || 10000 })
  if (!AMOUNT_UNITS['亿']) list.push({ name: '亿', factor: AMOUNT_UNITS['亿元'] || 100000000 })
  return list
}

/**
 * 清洗带单位金额，输出只含「数字 / 小数点 / 单位汉字」的 token 串。
 * 流程：全角转半角 -> 去货币标识与千分位 -> 其余杂符退化为空格。
 * 杂符退化成空格而不是直接删，是为了防止「2026年中标500万元」被粘成「2026500万元」。
 */
export function cleanAmountText(raw) {
  let s = toHalfWidth(raw)
  s = s.replace(/人民币|RMB|港币|美元|[¥$€£¢]/gi, '')   // 货币标识整体剔除
  s = s.replace(/[\s,]/g, '')                          // 千分位逗号、空白直接删，保证 1,234.56 是一个数
  const allowed = '0123456789.万亿' + Object.keys(AMOUNT_UNITS).join('')
  s = s.replace(new RegExp('[^' + escapeCharClass(allowed) + ']', 'g'), ' ')
  return s.replace(/(^|\s)\.(\d+)/g, function (_, lead, digits) {
    return lead + '0.' + digits
  }).trim()  // .5 万 -> 0.5 万
}

// 单位紧邻优先：取单位左侧最近的数；单位前置（万元：500）时取右侧第一个数。
function pickNumber(text, unitIndex, unitLength) {
  const re = /\d+(?:\.\d+)?/g
  let m, before = null, after = null
  while ((m = re.exec(text))) {
    if (m.index + m[0].length <= unitIndex) before = m[0]
    else if (m.index >= unitIndex + unitLength && after === null) after = m[0]
  }
  return before || after || null
}

/**
 * 带单位金额 -> { yuan: 精确「元」文本, wan: 万元两位, unit }；纯数字默认「元」。
 * 容错范围：缺失「元」字、括号包裹、单位前置、货币前缀、千分位、全半角混用、任意隔断。
 * 倍率最大的单位胜出，天然满足 亿 > 万 > 元；业务配置新增单位同样生效。
 * 识别不到任何数字时返回 null。
 */
export function parseAmount(raw) {
  const text = cleanAmountText(raw)
  if (!text) return null
  const numbers = []
  const numRe = /\d+(?:\.\d+)?/g
  let m
  while ((m = numRe.exec(text))) numbers.push(m[0])
  if (!numbers.length) return null

  let best = null
  unitEntries().forEach(function (entry) {
    if (!entry.name) return
    const idx = text.indexOf(entry.name)
    if (idx < 0) return
    if (!best || entry.factor > best.factor) best = { name: entry.name, factor: entry.factor, index: idx }
  })

  const num = best ? pickNumber(text, best.index, best.name.length) : numbers[0]
  if (num === null) return null
  const yuan = scaleDecimal(num, best ? best.factor : 1)
  return { yuan: yuan, wan: wanText(yuan), unit: best ? best.name : '元' }
}

/* ---------- 评委智能识别（7.5 / 11.4） ---------- */

// 只保留两类角色：组长、业主。业主口径覆盖采购人代表/采购人/业主/甲方代表/招标人代表/采购方代表等；
// 其余称谓（副组长、组长助理、专家、主任等）只当噪声清理，不建属性。
const JUDGE_OWNER_WORDS = [
  '采购人代表', '采购方代表', '招标人代表', '甲方代表', '业主代表',
  '采购人', '采购方', '招标人', '甲方', '业主'
]
const JUDGE_LABEL_WORDS = [
  '评标委员会成员', '评标专家', '采购人代表', '采购方代表', '招标人代表', '甲方代表', '业主代表',
  '副组长', '组长助理', '采购人', '采购方', '招标人', '甲方', '业主',
  '组长', '评委姓名', '姓名', '评委', '专家', '代表', '同志', '老师', '先生', '女士', '教授', '主任', '成员'
]

function judgeHasOwner(text) {
  return JUDGE_OWNER_WORDS.some(function (w) { return text.indexOf(w) >= 0 })
}
function judgeHasLeader(text) {
  return /组长/.test(String(text).replace(/副组长|组长助理/g, ''))
}

// 顶层断句：先全角归一，空格/斜杠/竖线/句号/编号也作为分隔符；括号内不拆。
function splitJudgeFragments(text) {
  let s = toHalfWidth(String(text == null ? '' : text))
  // 连接词断句：两侧都有汉字才生效，避免把「和平」这类姓名从中间切开
  s = s.replace(/([\u4e00-\u9fa5]{2,4})(和|及|与)(?=[\u4e00-\u9fa5·・]{2,4})/g, '$1、')
  s = s.replace(/([)\]】〕])\s*(和|及|与)\s*/g, '$1、')
  const out = []
  let buf = '', depth = 0
  const delims = '、,;|/\\。\t\n\r '
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if ('([〔'.indexOf(ch) >= 0) { depth++; buf += ch; continue }
    if (')]〕'.indexOf(ch) >= 0) { depth = depth > 0 ? depth - 1 : 0; buf += ch; continue }
    if (depth === 0 && delims.indexOf(ch) >= 0) {
      // 英文姓名里的单个空格不拆（John Smith 整段保留为无法识别原文）
      if (ch === ' ' && /[A-Za-z]/.test(buf.slice(-1)) && /[A-Za-z]/.test(s[i + 1] || '')) { buf += ch; continue }
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

// 括号内容单独收起来判角色，姓名只从剩余部分取
function splitJudgeBrackets(part) {
  let inner = ''
  const rest = part.replace(/[(\[【〔]([^)\]】〕]*)[)\]】〕]/g, function (mm, body) {
    inner += (inner ? '、' : '') + body
    return ' '
  })
  return { rest: rest, inner: inner }
}

// 剥包号 / 编号 / 称谓，只留汉字与姓名间隔点
function cleanJudgeName(s) {
  let t = toHalfWidth(s)
  t = t.replace(/包\s*[0-9一二三四五六七八九十百千两]+/g, '')
  t = t.replace(/^[(\[]?\s*\d+\s*[)\]]?\s*[.．、:：]?\s*/, '')
  JUDGE_LABEL_WORDS.forEach(function (w) { t = t.split(w).join('') })
  t = t.replace(/[^\u4e00-\u9fa5·・]/g, '')
  return t.replace(/^[·・]+|[·・]+$/g, '')
}

export function parseJudges(text) {
  const list = [], unknown = [], byName = new Map()
  splitJudgeFragments(text).forEach(function (part) {
    if (!part) return
    const br = splitJudgeBrackets(part)
    const name = (/[\u4e00-\u9fa5][\u4e00-\u9fa5·・]{1,7}/.exec(cleanJudgeName(br.rest)) || [])[0] || ''
    const roleText = br.inner + '、' + br.rest
    const leader = judgeHasLeader(roleText)
    const owner = judgeHasOwner(roleText)
    // 含字母 / # / @ 等垃圾的片段不取名，避免「无法识别##」被当成姓名
    const hasJunk = /[A-Za-z#@$%^&*?<>|\\]/.test(part)
    if (!name || hasJunk) {
      if (hasJunk || /[\u4e00-\u9fa5]/.test(part)) unknown.push(part)
      return
    }
    const prev = byName.get(name)
    if (prev) { prev.leader = prev.leader || leader; prev.owner = prev.owner || owner }
    else {
      const j = { name: name, leader: leader, owner: owner }
      byName.set(name, j)
      list.push(j)
    }
  })
  return { list: list, unknown: unknown }
}

/* ---------- 状态互斥判空（2.3（3）） ---------- */

// 只判断传入模块自身，绝不牵连意向公示 / 正在招标 / 公共信息
export function hasStageData(obj) {
  if (!obj || typeof obj !== 'object') return false
  return Object.keys(obj).some(function (k) {
    if (k === 'isSplit' || k === 'isUnion') return false
    const v = obj[k]
    if (Array.isArray(v)) return v.some(function (x) { return typeof x === 'string' ? !!x.trim() : hasStageData(x) })
    if (v && typeof v === 'object') return hasStageData(v)
    return String(v == null ? '' : v).trim() !== ''
  })
}

export function emptyWinner() { return { lead: '', members: [''], isUnion: false } }
export function emptyCompleted() {
  return {
    type: '', amount_yuan: '', winDate: '', winner: emptyWinner(),
    isSplit: false, packages: [], judges: [], url: ''
  }
}
export function emptyTerminated() { return { reason: '', note: '', url: '' } }

/* ---------- 分包 / 联合体（10.3 / 10.4） ---------- */

export function normPkg(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase().replace(/[\uff01-\uff5e]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  })
}

export function packageDuplicateErrors(packages) {
  const errors = {}
  const arr = Array.isArray(packages) ? packages : []
  const names = arr.map(function (p) { return normPkg(p && p.name) }).filter(Boolean)
  arr.forEach(function (p, i) {
    if (p && p.name && names.filter(function (n) { return n === normPkg(p.name); }).length > 1) {
      errors['completed.packages.' + i + '.name'] = '包号/包名重复'
    }
  })
  return errors
}

export function validateWinner(w) {
  if (!w || !w.isUnion) return ''
  const lead = String(w.lead == null ? '' : w.lead).trim()
  const members = (Array.isArray(w.members) ? w.members : []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean)
  if (!lead) return '请输入牵头单位'
  if (!members.length) return '成员单位至少 1 家'
  if (members.length > 10) return '成员单位最多 10 家'
  if (new Set(members).size !== members.length) return '成员单位重复'
  if (members.indexOf(lead) >= 0) return '牵头单位与成员单位重复'
  return ''
}

// 收集 detail 内所有网址字段，供服务端二次校验与前端提交前统一扫描
export function collectUrlPaths(d) {
  const paths = [
    ['intention.url', d.intention && d.intention.url],
    ['bidding.url', d.bidding && d.bidding.url],
    ['terminated.url', d.terminated && d.terminated.url],
    ['completed.url', d.completed && d.completed.url]
  ]
  ;(d.corrections || []).forEach(function (c, i) { paths.push(['corrections.' + i + '.url', c && c.url]) })
  return paths
}
